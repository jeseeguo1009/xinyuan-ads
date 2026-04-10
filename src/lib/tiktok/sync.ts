/**
 * TikTok 数据同步逻辑
 *
 * 被两个地方调用:
 *  1. Supabase Edge Function(定时每小时)- 自动同步
 *  2. Next.js API Route(/api/sync/tiktok)- 用户点"立即同步"按钮
 *
 * 流程(每个账户):
 *  1. 检查 token 是否即将过期 → 过期就刷新
 *  2. 拉 campaigns → ad_groups → ads(三层嵌套)
 *  3. 拉最近 N 天的日度指标
 *  4. upsert 到 ads.campaigns / ad_groups / ads / daily_metrics
 *  5. 写入 ads.sync_logs 记录状态和错误
 *
 * 注意:
 *  - 只对 platform='tiktok_shop' 且 is_active=true 且非 mock 账户生效
 *  - mock 账户(external_account_id like 'mock-%')自动跳过
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  TikTokMarketingClient,
  TikTokAPIError,
  type TikTokCampaign,
  type TikTokAdGroup,
  type TikTokAd,
  type TikTokDailyMetric,
} from './marketing-api';
import { refreshAccessToken } from './auth';
import { format, subDays } from 'date-fns';

export interface SyncResult {
  accountId: string;
  accountName: string;
  success: boolean;
  campaignsUpserted: number;
  adGroupsUpserted: number;
  adsUpserted: number;
  metricsUpserted: number;
  durationMs: number;
  error?: string;
}

/** 把 TikTok 的 status 映射到我们的 enum */
function mapStatus(tiktokStatus: string): string {
  const s = tiktokStatus.toUpperCase();
  if (s === 'ENABLE' || s === 'ENABLED' || s === 'ACTIVE') return 'enabled';
  if (s === 'DISABLE' || s === 'DISABLED' || s === 'PAUSED' || s === 'PAUSE')
    return 'paused';
  if (s === 'DELETE' || s === 'DELETED') return 'deleted';
  if (s === 'PENDING' || s === 'UNDER_REVIEW') return 'pending';
  if (s === 'REJECTED') return 'rejected';
  return 'enabled';
}

/** 把 TikTok 的 objective 映射到我们的 enum */
function mapObjective(tiktokObjective: string): string {
  const o = tiktokObjective.toUpperCase();
  if (o.includes('SALES') || o.includes('PRODUCT')) return 'product_sales';
  if (o.includes('TRAFFIC')) return 'traffic';
  if (o.includes('VIDEO')) return 'video_views';
  if (o.includes('FOLLOWER')) return 'followers';
  if (o.includes('LIVE')) return 'live_room_promotion';
  return 'product_sales';
}

/**
 * 同步单个账户
 * @param accountId ads.accounts.id
 * @param daysWindow 指标回拉天数,默认 7(增量同步)
 */
export async function syncTikTokAccount(
  accountId: string,
  daysWindow = 7
): Promise<SyncResult> {
  const start = Date.now();
  const supabase = createServiceRoleClient();
  let accountName = '';

  // 记录同步开始
  const { data: syncLog } = await supabase
    .schema('ads')
    .from('sync_logs')
    .insert({
      account_id: accountId,
      sync_type: 'tiktok_incremental',
      status: 'running',
    })
    .select('id')
    .single();

  try {
    // 1. 拉账户信息
    const { data: account, error: accErr } = await supabase
      .schema('ads')
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .single();
    if (accErr) throw accErr;
    if (!account) throw new Error('账户不存在');

    accountName = account.account_name;

    // Mock 账户跳过
    if (account.external_account_id?.startsWith('mock-')) {
      return {
        accountId,
        accountName,
        success: true,
        campaignsUpserted: 0,
        adGroupsUpserted: 0,
        adsUpserted: 0,
        metricsUpserted: 0,
        durationMs: Date.now() - start,
        error: 'Mock 账户,跳过同步',
      };
    }

    // 平台检查
    if (account.platform !== 'tiktok_shop') {
      throw new Error(`账户平台 ${account.platform} 不是 tiktok_shop`);
    }

    // 2. 检查 token 是否快过期(剩余 < 2 天就刷新)
    let accessToken = account.access_token;
    const expiresAt = account.token_expires_at
      ? new Date(account.token_expires_at).getTime()
      : 0;
    if (expiresAt < Date.now() + 2 * 24 * 3600 * 1000) {
      if (!account.refresh_token) {
        throw new Error('Token 过期且无 refresh_token,需要重新授权');
      }
      const refreshed = await refreshAccessToken(account.refresh_token);
      accessToken = refreshed.access_token;
      await supabase
        .schema('ads')
        .from('accounts')
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_expires_at: new Date(
            refreshed.access_token_expire_in * 1000
          ).toISOString(),
        })
        .eq('id', accountId);
    }

    // 3. 创建 API 客户端
    const shopId = account.external_shop_id ?? account.external_account_id;
    const client = new TikTokMarketingClient(accessToken!, shopId);

    // 4. 拉 campaigns(分页)
    const allCampaigns: TikTokCampaign[] = [];
    let page = 1;
    while (true) {
      const { campaigns, total } = await client.getCampaigns({ page, pageSize: 100 });
      allCampaigns.push(...campaigns);
      if (allCampaigns.length >= total || campaigns.length === 0) break;
      page++;
    }

    // upsert 到 ads.campaigns
    const campaignRows = allCampaigns.map((c) => ({
      account_id: accountId,
      external_campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      objective: mapObjective(c.objective_type),
      status: mapStatus(c.status),
      budget: c.budget,
      budget_type: c.budget_mode?.includes('DAY') ? 'daily' : 'total',
      last_synced_at: new Date().toISOString(),
    }));

    if (campaignRows.length > 0) {
      await supabase
        .schema('ads')
        .from('campaigns')
        .upsert(campaignRows, { onConflict: 'account_id,external_campaign_id' });
    }

    // 拿回我们数据库里的 campaign_id 映射
    const { data: dbCampaigns } = await supabase
      .schema('ads')
      .from('campaigns')
      .select('id, external_campaign_id')
      .eq('account_id', accountId);

    const campaignIdMap = new Map(
      (dbCampaigns ?? []).map((c) => [c.external_campaign_id, c.id])
    );

    // 5. 拉 ad_groups
    const allAdGroups: TikTokAdGroup[] = [];
    if (allCampaigns.length > 0) {
      page = 1;
      while (true) {
        const { adGroups, total } = await client.getAdGroups({
          campaignIds: allCampaigns.map((c) => c.campaign_id),
          page,
          pageSize: 100,
        });
        allAdGroups.push(...adGroups);
        if (allAdGroups.length >= total || adGroups.length === 0) break;
        page++;
      }
    }

    const adGroupRows = allAdGroups
      .map((g) => {
        const campId = campaignIdMap.get(g.campaign_id);
        if (!campId) return null;
        return {
          campaign_id: campId,
          external_ad_group_id: g.ad_group_id,
          ad_group_name: g.ad_group_name,
          status: mapStatus(g.status),
          bid_amount: g.bid_price,
          bid_type: g.bid_type?.toLowerCase(),
          targeting: g.targeting ?? {},
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (adGroupRows.length > 0) {
      await supabase
        .schema('ads')
        .from('ad_groups')
        .upsert(adGroupRows as unknown as Record<string, unknown>[], {
          onConflict: 'campaign_id,external_ad_group_id',
        });
    }

    // 拿回 db 的 ad_group_id 映射
    const { data: dbAdGroups } = await supabase
      .schema('ads')
      .from('ad_groups')
      .select('id, external_ad_group_id, campaign_id');
    const adGroupIdMap = new Map(
      (dbAdGroups ?? []).map((g) => [g.external_ad_group_id, g.id])
    );

    // 6. 拉 ads
    const allAds: TikTokAd[] = [];
    if (allAdGroups.length > 0) {
      page = 1;
      while (true) {
        const { ads, total } = await client.getAds({
          adGroupIds: allAdGroups.map((g) => g.ad_group_id),
          page,
          pageSize: 100,
        });
        allAds.push(...ads);
        if (allAds.length >= total || ads.length === 0) break;
        page++;
      }
    }

    const adRows = allAds
      .map((a) => {
        const gId = adGroupIdMap.get(a.ad_group_id);
        if (!gId) return null;
        return {
          ad_group_id: gId,
          external_ad_id: a.ad_id,
          ad_name: a.ad_name,
          status: mapStatus(a.status),
          sku_code: a.sku_id,
          creative_type: a.creative_type,
          creative_url: a.video_url ?? a.image_url,
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (adRows.length > 0) {
      await supabase
        .schema('ads')
        .from('ads')
        .upsert(adRows as unknown as Record<string, unknown>[], {
          onConflict: 'ad_group_id,external_ad_id',
        });
    }

    const { data: dbAds } = await supabase
      .schema('ads')
      .from('ads')
      .select('id, external_ad_id');
    const adIdMap = new Map((dbAds ?? []).map((a) => [a.external_ad_id, a.id]));

    // 7. 拉指标
    const endDate = format(new Date(), 'yyyy-MM-dd');
    const startDate = format(subDays(new Date(), daysWindow), 'yyyy-MM-dd');
    const metrics: TikTokDailyMetric[] = await client.getDailyMetrics({
      startDate,
      endDate,
      dimension: 'ad',
    });

    // 查当日汇率(简化:取最新一行)
    const { data: latestRate } = await supabase
      .schema('ads')
      .from('exchange_rates')
      .select('rate_to_cny')
      .eq('currency', account.currency)
      .order('rate_date', { ascending: false })
      .limit(1)
      .single();
    const rate = latestRate?.rate_to_cny ?? 1;

    const metricRows = metrics
      .map((m) => {
        if (!m.ad_id) return null;
        const adId = adIdMap.get(m.ad_id);
        if (!adId) return null;
        const spendLocal = m.spend ?? 0;
        const gmvLocal = m.gross_revenue ?? 0;
        const spendCny = +(spendLocal * rate).toFixed(4);
        const gmvCny = +(gmvLocal * rate).toFixed(4);
        const clicks = m.clicks ?? 0;
        const impressions = m.impressions ?? 0;
        const orders = m.orders ?? 0;
        return {
          account_id: accountId,
          ad_id: adId,
          stat_date: m.stat_time_day,
          impressions,
          clicks,
          spend_local: spendLocal,
          spend_cny: spendCny,
          exchange_rate: rate,
          orders,
          gmv_local: gmvLocal,
          gmv_cny: gmvCny,
          ctr: impressions > 0 ? clicks / impressions : 0,
          cpc_cny: clicks > 0 ? spendCny / clicks : 0,
          cpm_cny: impressions > 0 ? (spendCny / impressions) * 1000 : 0,
          cvr: clicks > 0 ? orders / clicks : 0,
          roi: spendCny > 0 ? gmvCny / spendCny : 0,
          cpa_cny: orders > 0 ? spendCny / orders : 0,
          data_source: 'api',
          synced_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (metricRows.length > 0) {
      await supabase
        .schema('ads')
        .from('daily_metrics')
        .upsert(metricRows as unknown as Record<string, unknown>[], {
          onConflict: 'ad_id,stat_date',
        });
    }

    // 更新 sync_log
    if (syncLog?.id) {
      const totalUpserted =
        campaignRows.length + adGroupRows.length + adRows.length + metricRows.length;
      await supabase
        .schema('ads')
        .from('sync_logs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - start,
          records_fetched: metrics.length,
          records_upserted: totalUpserted,
        })
        .eq('id', syncLog.id);
    }

    return {
      accountId,
      accountName,
      success: true,
      campaignsUpserted: campaignRows.length,
      adGroupsUpserted: adGroupRows.length,
      adsUpserted: adRows.length,
      metricsUpserted: metricRows.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const errorMsg =
      err instanceof TikTokAPIError
        ? `TikTok API ${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);

    if (syncLog?.id) {
      await supabase
        .schema('ads')
        .from('sync_logs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - start,
          error_message: errorMsg,
        })
        .eq('id', syncLog.id);
    }

    return {
      accountId,
      accountName,
      success: false,
      campaignsUpserted: 0,
      adGroupsUpserted: 0,
      adsUpserted: 0,
      metricsUpserted: 0,
      durationMs: Date.now() - start,
      error: errorMsg,
    };
  }
}

/** 同步所有活跃的 TikTok 账户 */
export async function syncAllTikTokAccounts(
  daysWindow = 7
): Promise<SyncResult[]> {
  const supabase = createServiceRoleClient();
  const { data: accounts, error } = await supabase
    .schema('ads')
    .from('accounts')
    .select('id')
    .eq('platform', 'tiktok_shop')
    .eq('is_active', true);

  if (error) throw error;

  const results: SyncResult[] = [];
  for (const acc of accounts ?? []) {
    const result = await syncTikTokAccount(acc.id, daysWindow);
    results.push(result);
  }
  return results;
}

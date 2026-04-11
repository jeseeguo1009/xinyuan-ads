/**
 * TikTok Business API 数据同步
 *
 * 和 Shop API sync 的区别:
 *  - 使用 Business API 客户端(不需要 HMAC 签名)
 *  - 通过 advertiser_id 拉数据(不是 shop_id)
 *  - 报表接口字段名不同
 *  - token 长期有效,不需要频繁刷新
 *
 * 流程:
 *  1. 读 access_token 和 advertiser_id
 *  2. 拉 campaigns → ad_groups → ads
 *  3. 拉日度报表
 *  4. upsert 到 ads schema 的表里
 *  5. 写 sync_logs
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  TikTokBusinessClient,
  TikTokBusinessError,
  type BusinessCampaign,
  type BusinessAdGroup,
  type BusinessAd,
} from './business-api';
import { format, subDays } from 'date-fns';

export interface BusinessSyncResult {
  advertiserId: string;
  success: boolean;
  campaignsUpserted: number;
  adGroupsUpserted: number;
  adsUpserted: number;
  metricsUpserted: number;
  durationMs: number;
  error?: string;
}

/** Business API 的 status 映射 */
function mapStatus(s: string): string {
  const upper = s.toUpperCase();
  if (upper.includes('ENABLE')) return 'enabled';
  if (upper.includes('DISABLE') || upper.includes('PAUSE')) return 'paused';
  if (upper.includes('DELETE')) return 'deleted';
  if (upper.includes('PENDING') || upper.includes('REVIEW')) return 'pending';
  if (upper.includes('REJECT')) return 'rejected';
  return 'enabled';
}

function mapObjective(o: string): string {
  const upper = o.toUpperCase();
  if (upper.includes('SALES') || upper.includes('PRODUCT')) return 'product_sales';
  if (upper.includes('TRAFFIC')) return 'traffic';
  if (upper.includes('VIDEO')) return 'video_views';
  if (upper.includes('FOLLOWER')) return 'followers';
  if (upper.includes('LIVE')) return 'live_room_promotion';
  return 'product_sales';
}

/**
 * 用 Business API 同步广告数据
 *
 * @param accessToken Business API access token
 * @param advertiserId 广告主 ID
 * @param accountId 数据库里的 account ID（可选,没有则自动创建/查找）
 * @param daysWindow 回拉天数
 */
export async function syncBusinessAccount(
  accessToken: string,
  advertiserId: string,
  accountId?: string,
  daysWindow = 7
): Promise<BusinessSyncResult> {
  const start = Date.now();
  const supabase = createServiceRoleClient();

  // 如果没有指定 accountId,先查或创建
  if (!accountId) {
    const extId = `business-${advertiserId}`;
    const { data: existing } = await supabase
      .schema('ads')
      .from('accounts')
      .select('id')
      .eq('platform', 'tiktok_shop')
      .eq('external_account_id', extId)
      .single();

    if (existing) {
      accountId = existing.id;
    } else {
      // 自动创建账户记录
      const { data: created, error: createErr } = await supabase
        .schema('ads')
        .from('accounts')
        .insert({
          platform: 'tiktok_shop',
          market: 'ALL',
          external_account_id: extId,
          account_name: `TikTok Ads ${advertiserId}`,
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
          currency: 'THB', // 默认泰铢,后续可改
          timezone: 'Asia/Bangkok',
          is_active: true,
        })
        .select('id')
        .single();

      if (createErr) {
        return {
          advertiserId,
          success: false,
          campaignsUpserted: 0,
          adGroupsUpserted: 0,
          adsUpserted: 0,
          metricsUpserted: 0,
          durationMs: Date.now() - start,
          error: `创建账户失败: ${createErr.message}`,
        };
      }
      accountId = created!.id;
    }
  }

  // 记录同步开始
  const { data: syncLog } = await supabase
    .schema('ads')
    .from('sync_logs')
    .insert({
      account_id: accountId,
      sync_type: 'tiktok_business_incremental',
      status: 'running',
    })
    .select('id')
    .single();

  try {
    const client = new TikTokBusinessClient(accessToken, advertiserId);

    // 1. 拉 campaigns（分页）
    const allCampaigns: BusinessCampaign[] = [];
    let page = 1;
    while (true) {
      const { campaigns, total } = await client.getCampaigns({ page, pageSize: 100 });
      allCampaigns.push(...campaigns);
      if (allCampaigns.length >= total || campaigns.length === 0) break;
      page++;
    }

    // upsert campaigns
    const campaignRows = allCampaigns.map((c) => ({
      account_id: accountId,
      external_campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      objective: mapObjective(c.objective_type),
      status: mapStatus(c.status),
      budget: c.budget,
      budget_type: c.budget_mode?.includes('DAY') ? 'daily' : c.budget_mode?.includes('TOTAL') ? 'total' : 'unlimited',
      last_synced_at: new Date().toISOString(),
    }));

    if (campaignRows.length > 0) {
      await supabase
        .schema('ads')
        .from('campaigns')
        .upsert(campaignRows, { onConflict: 'account_id,external_campaign_id' });
    }

    // 拿回 campaign ID 映射
    const { data: dbCampaigns } = await supabase
      .schema('ads')
      .from('campaigns')
      .select('id, external_campaign_id')
      .eq('account_id', accountId);
    const campaignIdMap = new Map(
      (dbCampaigns ?? []).map((c) => [c.external_campaign_id, c.id])
    );

    // 2. 拉 ad_groups
    const allAdGroups: BusinessAdGroup[] = [];
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
          external_ad_group_id: g.adgroup_id,
          ad_group_name: g.adgroup_name,
          status: mapStatus(g.status),
          bid_amount: g.bid_price,
          bid_type: g.bid_type?.toLowerCase(),
          targeting: {},
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (adGroupRows.length > 0) {
      await supabase
        .schema('ads')
        .from('ad_groups')
        .upsert(adGroupRows as Record<string, unknown>[], {
          onConflict: 'campaign_id,external_ad_group_id',
        });
    }

    // 拿回 ad_group ID 映射
    const { data: dbAdGroups } = await supabase
      .schema('ads')
      .from('ad_groups')
      .select('id, external_ad_group_id');
    const adGroupIdMap = new Map(
      (dbAdGroups ?? []).map((g) => [g.external_ad_group_id, g.id])
    );

    // 3. 拉 ads
    const allAds: BusinessAd[] = [];
    if (allAdGroups.length > 0) {
      page = 1;
      while (true) {
        const { ads, total } = await client.getAds({
          adGroupIds: allAdGroups.map((g) => g.adgroup_id),
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
        const gId = adGroupIdMap.get(a.adgroup_id);
        if (!gId) return null;
        return {
          ad_group_id: gId,
          external_ad_id: a.ad_id,
          ad_name: a.ad_name,
          status: mapStatus(a.status),
          creative_type: a.ad_format,
          last_synced_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (adRows.length > 0) {
      await supabase
        .schema('ads')
        .from('ads')
        .upsert(adRows as Record<string, unknown>[], {
          onConflict: 'ad_group_id,external_ad_id',
        });
    }

    // 拿回 ad ID 映射
    const { data: dbAds } = await supabase
      .schema('ads')
      .from('ads')
      .select('id, external_ad_id');
    const adIdMap = new Map((dbAds ?? []).map((a) => [a.external_ad_id, a.id]));

    // 4. 拉报表（日度指标）
    const endDate = format(new Date(), 'yyyy-MM-dd');
    const startDate = format(subDays(new Date(), daysWindow), 'yyyy-MM-dd');

    const { rows: reportRows } = await client.getReport({
      startDate,
      endDate,
      dimension: 'AUCTION_AD',
    });

    // 查汇率
    const { data: account } = await supabase
      .schema('ads')
      .from('accounts')
      .select('currency')
      .eq('id', accountId)
      .single();

    const { data: latestRate } = await supabase
      .schema('ads')
      .from('exchange_rates')
      .select('rate_to_cny')
      .eq('currency', account?.currency ?? 'THB')
      .order('rate_date', { ascending: false })
      .limit(1)
      .single();
    const rate = latestRate?.rate_to_cny ?? 1;

    const metricRows = reportRows
      .map((row) => {
        const adExtId = row.dimensions.ad_id;
        if (!adExtId) return null;
        const adId = adIdMap.get(adExtId);
        if (!adId) return null;

        const spend = parseFloat(row.metrics.spend ?? '0');
        const gmv = parseFloat(row.metrics.total_onsite_shopping_value ?? '0');
        const impressions = parseInt(row.metrics.impressions ?? '0', 10);
        const clicks = parseInt(row.metrics.clicks ?? '0', 10);
        const orders = parseInt(row.metrics.complete_payment ?? '0', 10);
        const spendCny = +(spend * rate).toFixed(4);
        const gmvCny = +(gmv * rate).toFixed(4);

        return {
          account_id: accountId,
          ad_id: adId,
          stat_date: row.dimensions.stat_time_day,
          impressions,
          clicks,
          spend_local: spend,
          spend_cny: spendCny,
          exchange_rate: rate,
          orders,
          gmv_local: gmv,
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
        .upsert(metricRows as Record<string, unknown>[], {
          onConflict: 'ad_id,stat_date',
        });
    }

    // 更新 sync_log
    const totalUpserted = campaignRows.length + adGroupRows.length + adRows.length + metricRows.length;
    if (syncLog?.id) {
      await supabase
        .schema('ads')
        .from('sync_logs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - start,
          records_fetched: reportRows.length,
          records_upserted: totalUpserted,
        })
        .eq('id', syncLog.id);
    }

    return {
      advertiserId,
      success: true,
      campaignsUpserted: campaignRows.length,
      adGroupsUpserted: adGroupRows.length,
      adsUpserted: adRows.length,
      metricsUpserted: metricRows.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const errorMsg =
      err instanceof TikTokBusinessError
        ? `Business API ${err.code}: ${err.message}`
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
      advertiserId,
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

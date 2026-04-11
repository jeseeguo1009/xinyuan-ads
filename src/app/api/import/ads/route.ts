/**
 * POST /api/import/ads
 *
 * 导入 Seller Center 导出的广告报表 xlsx
 *
 * FormData:
 *   file: xlsx 文件
 *   accountId: 目标账户 ID
 *   statDate: 统计日期 YYYY-MM-DD
 *   exchangeRate: USD→CNY 汇率(可选,默认 7.2)
 *
 * 处理流程:
 *   1. 解析 xlsx
 *   2. 跳过花费=0 的行
 *   3. 每个广告计划 → upsert campaign + 虚拟 ad_group + 虚拟 ad
 *   4. 写 daily_metrics
 *   5. 写 sync_logs
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ParsedRow {
  campaignId: string;
  campaignName: string;
  spend: number;      // 成本(USD)
  netSpend: number;    // 净成本
  budget: number;      // 当前预算
  orders: number;      // SKU 订单数
  cpa: number;         // 平均下单成本
  gmv: number;         // 总收入
  roi: number;         // ROI
  currency: string;    // 货币
}

function parseXlsx(buffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

  if (raw.length < 2) {
    throw new Error('文件为空或格式不对');
  }

  // 验证表头
  const header = raw[0];
  if (!header[0]?.includes('广告计划') && !header[0]?.toLowerCase().includes('campaign')) {
    throw new Error(`表头不匹配,第一列应为"广告计划 ID"，实际: ${header[0]}`);
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r[0]) continue;

    const spend = parseFloat(String(r[2])) || 0;
    // 跳过花费为 0 的行
    if (spend <= 0) continue;

    rows.push({
      campaignId: String(r[0]),
      campaignName: String(r[1] ?? ''),
      spend,
      netSpend: parseFloat(String(r[4])) || 0,
      budget: parseFloat(String(r[5])) || 0,
      orders: parseInt(String(r[6])) || 0,
      cpa: parseFloat(String(r[7])) || 0,
      gmv: parseFloat(String(r[8])) || 0,
      roi: parseFloat(String(r[9])) || 0,
      currency: String(r[10] ?? 'USD'),
    });
  }

  return rows;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const accountId = formData.get('accountId') as string | null;
    const statDate = formData.get('statDate') as string | null;
    const rateStr = formData.get('exchangeRate') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: '请上传文件' }, { status: 400 });
    }
    if (!accountId) {
      return NextResponse.json({ success: false, error: '请选择店铺' }, { status: 400 });
    }
    if (!statDate) {
      return NextResponse.json({ success: false, error: '请指定日期' }, { status: 400 });
    }

    const exchangeRate = parseFloat(rateStr ?? '7.2');

    // 解析文件
    const buffer = await file.arrayBuffer();
    const rows = parseXlsx(buffer);

    if (rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: '没有有效数据（所有行花费为 0）',
      }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 验证账户存在
    const { data: account, error: accErr } = await supabase
      .schema('ads')
      .from('accounts')
      .select('id, account_name, currency')
      .eq('id', accountId)
      .single();
    if (accErr || !account) {
      return NextResponse.json({ success: false, error: '店铺不存在' }, { status: 400 });
    }

    // 记录同步日志
    const { data: syncLog } = await supabase
      .schema('ads')
      .from('sync_logs')
      .insert({
        account_id: accountId,
        sync_type: 'xlsx_import',
        status: 'running',
        target_date: statDate,
      })
      .select('id')
      .single();

    const start = Date.now();
    let campaignsUpserted = 0;
    let metricsUpserted = 0;

    for (const row of rows) {
      // 1. Upsert campaign
      const { data: camp } = await supabase
        .schema('ads')
        .from('campaigns')
        .upsert(
          {
            account_id: accountId,
            external_campaign_id: row.campaignId,
            campaign_name: row.campaignName,
            objective: 'product_sales',
            status: 'enabled',
            budget: row.budget,
            budget_type: 'daily',
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,external_campaign_id' }
        )
        .select('id')
        .single();
      if (!camp) continue;
      campaignsUpserted++;

      // 2. Upsert 虚拟 ad_group（每个 campaign 一个）
      const { data: adGroup } = await supabase
        .schema('ads')
        .from('ad_groups')
        .upsert(
          {
            campaign_id: camp.id,
            external_ad_group_id: `import-${row.campaignId}`,
            ad_group_name: row.campaignName,
            status: 'enabled',
            targeting: {},
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'campaign_id,external_ad_group_id' }
        )
        .select('id')
        .single();
      if (!adGroup) continue;

      // 3. Upsert 虚拟 ad
      const { data: ad } = await supabase
        .schema('ads')
        .from('ads')
        .upsert(
          {
            ad_group_id: adGroup.id,
            external_ad_id: `import-${row.campaignId}`,
            ad_name: row.campaignName,
            status: 'enabled',
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'ad_group_id,external_ad_id' }
        )
        .select('id')
        .single();
      if (!ad) continue;

      // 4. Upsert daily_metrics
      const spendCny = +(row.spend * exchangeRate).toFixed(4);
      const gmvCny = +(row.gmv * exchangeRate).toFixed(4);

      const { error: metricErr } = await supabase
        .schema('ads')
        .from('daily_metrics')
        .upsert(
          {
            account_id: accountId,
            campaign_id: camp.id,
            ad_group_id: adGroup.id,
            ad_id: ad.id,
            stat_date: statDate,
            impressions: 0, // xlsx 里没有展现数据
            clicks: 0,      // xlsx 里没有点击数据
            spend_local: row.spend,
            spend_cny: spendCny,
            exchange_rate: exchangeRate,
            orders: row.orders,
            gmv_local: row.gmv,
            gmv_cny: gmvCny,
            ctr: 0,
            cpc_cny: 0,
            cpm_cny: 0,
            cvr: 0,
            roi: row.roi,
            cpa_cny: row.orders > 0 ? +(spendCny / row.orders).toFixed(4) : 0,
            data_source: 'xlsx_import',
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'ad_id,stat_date' }
        );

      if (!metricErr) metricsUpserted++;
    }

    // 更新 sync_log
    const durationMs = Date.now() - start;
    if (syncLog?.id) {
      await supabase
        .schema('ads')
        .from('sync_logs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          records_fetched: rows.length,
          records_upserted: metricsUpserted,
        })
        .eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalRows: rows.length,
        campaignsUpserted,
        metricsUpserted,
        statDate,
        exchangeRate,
        totalSpendUsd: +rows.reduce((s, r) => s + r.spend, 0).toFixed(2),
        totalGmvUsd: +rows.reduce((s, r) => s + r.gmv, 0).toFixed(2),
        totalOrders: rows.reduce((s, r) => s + r.orders, 0),
        durationMs,
      },
    });
  } catch (err) {
    console.error('[/api/import/ads] 失败:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/import/ads
 * 返回可选的账户列表
 */
export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const { data: accounts, error } = await supabase
      .schema('ads')
      .from('accounts')
      .select('id, account_name, market, currency, is_active')
      .eq('is_active', true)
      .order('market');

    if (error) throw error;

    return NextResponse.json({ accounts: accounts ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

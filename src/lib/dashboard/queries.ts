/**
 * 看板首页的数据查询 —— 聚合逻辑集中在这里
 * 所有查询走 service_role(服务端),避免 RLS 限制
 */
import { createServiceRoleClient } from '@/lib/supabase/server';
import { subDays, format } from 'date-fns';

export interface ShopSummary {
  id: string;
  market: string;
  country: string;
  flag: string; // 国旗 emoji
  accountName: string;
  currency: string;
  isActive: boolean;
  // 指标(窗口内聚合,原始货币 USD)
  spend: number;
  gmv: number;
  orders: number;
  impressions: number;
  clicks: number;
  roi: number; // gmv_cny / spend_cny
  ctr: number; // clicks / impressions
}

export interface DashboardData {
  windowDays: number;
  startDate: string;
  endDate: string;
  totals: {
    spend: number;
    gmv: number;
    orders: number;
    roi: number;
  };
  shops: ShopSummary[];
  /** 最近一次成功同步的时间(ISO) */
  lastSyncedAt: string | null;
}

/** market 代码 → 中文 + emoji */
const MARKET_INFO: Record<string, { country: string; flag: string }> = {
  TH: { country: '泰国', flag: '🇹🇭' },
  VN: { country: '越南', flag: '🇻🇳' },
  PH: { country: '菲律宾', flag: '🇵🇭' },
  MY: { country: '马来西亚', flag: '🇲🇾' },
  ID: { country: '印尼', flag: '🇮🇩' },
  SG: { country: '新加坡', flag: '🇸🇬' },
};

/**
 * 获取首页看板数据
 * @param opts 日期范围,两种用法:
 *   - { windowDays: 7 }  最近 N 天(快捷方式)
 *   - { from: '2026-03-01', to: '2026-03-15' }  指定范围
 *   - 不传 → 默认最近 7 天
 */
export async function getDashboardData(
  opts: { windowDays?: number; from?: string; to?: string } | number = {}
): Promise<DashboardData> {
  // 兼容老的 number 传参
  if (typeof opts === 'number') opts = { windowDays: opts };

  const supabase = createServiceRoleClient();
  let startDateStr: string;
  let endDateStr: string;
  let windowDays: number;

  if (opts.from && opts.to) {
    startDateStr = opts.from;
    endDateStr = opts.to;
    const from = new Date(opts.from);
    const to = new Date(opts.to);
    windowDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  } else {
    windowDays = opts.windowDays ?? 7;
    const endDate = new Date();
    const startDate = subDays(endDate, windowDays - 1);
    startDateStr = format(startDate, 'yyyy-MM-dd');
    endDateStr = format(endDate, 'yyyy-MM-dd');
  }

  // 1. 拉所有活跃账户
  const { data: accounts, error: accErr } = await supabase
    .schema('ads')
    .from('accounts')
    .select('id, market, account_name, currency, is_active')
    .eq('is_active', true)
    .order('market');

  if (accErr) throw accErr;
  if (!accounts || accounts.length === 0) {
    return {
      windowDays,
      startDate: startDateStr,
      endDate: endDateStr,
      totals: { spend: 0, gmv: 0, orders: 0, roi: 0 },
      shops: [],
      lastSyncedAt: null,
    };
  }

  // 2. 拉窗口内所有日度指标
  const { data: metrics, error: metricsErr } = await supabase
    .schema('ads')
    .from('daily_metrics')
    .select('account_id, spend_local, gmv_local, orders, impressions, clicks')
    .gte('stat_date', startDateStr)
    .lte('stat_date', endDateStr);

  if (metricsErr) throw metricsErr;

  // 3. 按 account_id 聚合
  const byAccount = new Map<
    string,
    { spend: number; gmv: number; orders: number; imp: number; clk: number }
  >();
  for (const m of metrics ?? []) {
    const acc = byAccount.get(m.account_id) ?? {
      spend: 0,
      gmv: 0,
      orders: 0,
      imp: 0,
      clk: 0,
    };
    acc.spend += Number(m.spend_local);
    acc.gmv += Number(m.gmv_local);
    acc.orders += m.orders;
    acc.imp += Number(m.impressions);
    acc.clk += Number(m.clicks);
    byAccount.set(m.account_id, acc);
  }

  // 4. 组装店铺摘要
  const shops: ShopSummary[] = accounts.map((acc) => {
    const agg = byAccount.get(acc.id) ?? {
      spend: 0,
      gmv: 0,
      orders: 0,
      imp: 0,
      clk: 0,
    };
    const info = MARKET_INFO[acc.market] ?? { country: acc.market, flag: '🏳️' };
    return {
      id: acc.id,
      market: acc.market,
      country: info.country,
      flag: info.flag,
      accountName: acc.account_name,
      currency: acc.currency,
      isActive: acc.is_active,
      spend: +agg.spend.toFixed(2),
      gmv: +agg.gmv.toFixed(2),
      orders: agg.orders,
      impressions: agg.imp,
      clicks: agg.clk,
      roi: agg.spend > 0 ? +(agg.gmv / agg.spend).toFixed(2) : 0,
      ctr: agg.imp > 0 ? +(agg.clk / agg.imp).toFixed(4) : 0,
    };
  });

  // 5. 总计
  const totalSpend = shops.reduce((s, x) => s + x.spend, 0);
  const totalGmv = shops.reduce((s, x) => s + x.gmv, 0);
  const totalOrders = shops.reduce((s, x) => s + x.orders, 0);

  // 查最近一次成功的同步
  const { data: lastSync } = await supabase
    .schema('ads')
    .from('sync_logs')
    .select('finished_at')
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    windowDays,
    startDate: startDateStr,
    endDate: endDateStr,
    totals: {
      spend: +totalSpend.toFixed(2),
      gmv: +totalGmv.toFixed(2),
      orders: totalOrders,
      roi: totalSpend > 0 ? +(totalGmv / totalSpend).toFixed(2) : 0,
    },
    shops,
    lastSyncedAt: lastSync?.finished_at ?? null,
  };
}

// =====================================================================
// 店铺详情页数据
// =====================================================================

export interface DailyPoint {
  date: string; // yyyy-MM-dd
  spend: number;
  gmv: number;
  orders: number;
  roi: number;
  spendRatio: number; // 花费占比 = spend / gmv × 100,%
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  spend: number;
  gmv: number;
  orders: number;
  roi: number;
}

export interface ShopDetail {
  shop: ShopSummary;
  windowDays: number;
  startDate: string;
  endDate: string;
  dailySeries: DailyPoint[];
  campaigns: CampaignRow[];
}

/**
 * 获取店铺详情页数据
 */
export async function getShopDetail(
  shopId: string,
  opts: { windowDays?: number; from?: string; to?: string } | number = {}
): Promise<ShopDetail | null> {
  if (typeof opts === 'number') opts = { windowDays: opts };
  const supabase = createServiceRoleClient();
  let startDateStr: string;
  let endDateStr: string;
  let windowDays: number;

  if (opts.from && opts.to) {
    startDateStr = opts.from;
    endDateStr = opts.to;
    const from = new Date(opts.from);
    const to = new Date(opts.to);
    windowDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  } else {
    windowDays = opts.windowDays ?? 30;
    const endDate = new Date();
    const startDate = subDays(endDate, windowDays - 1);
    startDateStr = format(startDate, 'yyyy-MM-dd');
    endDateStr = format(endDate, 'yyyy-MM-dd');
  }

  // 1. 店铺信息
  const { data: acc, error: accErr } = await supabase
    .schema('ads')
    .from('accounts')
    .select('id, market, account_name, currency, is_active')
    .eq('id', shopId)
    .maybeSingle();
  if (accErr) throw accErr;
  if (!acc) return null;

  const info = MARKET_INFO[acc.market] ?? { country: acc.market, flag: '🏳️' };

  // 2. 窗口内所有日度指标(含 campaign_id)
  const { data: metrics, error: mErr } = await supabase
    .schema('ads')
    .from('daily_metrics')
    .select('stat_date, spend_local, gmv_local, orders, impressions, clicks, ad_id')
    .eq('account_id', shopId)
    .gte('stat_date', startDateStr)
    .lte('stat_date', endDateStr)
    .order('stat_date');
  if (mErr) throw mErr;

  // 3. 按日期聚合 → dailySeries
  const byDate = new Map<
    string,
    { spend: number; gmv: number; orders: number; imp: number; clk: number }
  >();
  for (const m of metrics ?? []) {
    const bucket = byDate.get(m.stat_date) ?? {
      spend: 0,
      gmv: 0,
      orders: 0,
      imp: 0,
      clk: 0,
    };
    bucket.spend += Number(m.spend_local);
    bucket.gmv += Number(m.gmv_local);
    bucket.orders += m.orders;
    bucket.imp += Number(m.impressions);
    bucket.clk += Number(m.clicks);
    byDate.set(m.stat_date, bucket);
  }

  const dailySeries: DailyPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({
      date,
      spend: +v.spend.toFixed(2),
      gmv: +v.gmv.toFixed(2),
      orders: v.orders,
      roi: v.spend > 0 ? +(v.gmv / v.spend).toFixed(2) : 0,
      spendRatio: v.gmv > 0 ? +((v.spend / v.gmv) * 100).toFixed(2) : 0,
    }));

  // 4. 店铺窗口汇总(复用 ShopSummary 结构)
  const totalSpend = dailySeries.reduce((s, d) => s + d.spend, 0);
  const totalGmv = dailySeries.reduce((s, d) => s + d.gmv, 0);
  const totalOrders = dailySeries.reduce((s, d) => s + d.orders, 0);
  const totalImp = (metrics ?? []).reduce(
    (s, m) => s + Number(m.impressions),
    0
  );
  const totalClk = (metrics ?? []).reduce((s, m) => s + Number(m.clicks), 0);

  const shop: ShopSummary = {
    id: acc.id,
    market: acc.market,
    country: info.country,
    flag: info.flag,
    accountName: acc.account_name,
    currency: acc.currency,
    isActive: acc.is_active,
    spend: +totalSpend.toFixed(2),
    gmv: +totalGmv.toFixed(2),
    orders: totalOrders,
    impressions: totalImp,
    clicks: totalClk,
    roi: totalSpend > 0 ? +(totalGmv / totalSpend).toFixed(2) : 0,
    ctr: totalImp > 0 ? +(totalClk / totalImp).toFixed(4) : 0,
  };

  // 5. 查该店铺的所有 campaigns + 通过 ad_id 链路聚合
  // 先拿所有 campaigns
  const { data: camps, error: cErr } = await supabase
    .schema('ads')
    .from('campaigns')
    .select('id, campaign_name, status, objective')
    .eq('account_id', shopId);
  if (cErr) throw cErr;

  // 拿所有 ads,建立 ad_id → campaign_id 映射
  const { data: adsList, error: adsErr } = await supabase
    .schema('ads')
    .from('ads')
    .select('id, ad_group_id');
  if (adsErr) throw adsErr;

  const { data: groupsList, error: gErr } = await supabase
    .schema('ads')
    .from('ad_groups')
    .select('id, campaign_id');
  if (gErr) throw gErr;

  const groupToCamp = new Map<string, string>();
  for (const g of groupsList ?? []) groupToCamp.set(g.id, g.campaign_id);

  const adToCamp = new Map<string, string>();
  for (const a of adsList ?? []) {
    const c = groupToCamp.get(a.ad_group_id);
    if (c) adToCamp.set(a.id, c);
  }

  // 按 campaign 聚合 metrics
  const byCamp = new Map<
    string,
    { spend: number; gmv: number; orders: number }
  >();
  for (const m of metrics ?? []) {
    if (!m.ad_id) continue;
    const campId = adToCamp.get(m.ad_id);
    if (!campId) continue;
    const b = byCamp.get(campId) ?? { spend: 0, gmv: 0, orders: 0 };
    b.spend += Number(m.spend_local);
    b.gmv += Number(m.gmv_local);
    b.orders += m.orders;
    byCamp.set(campId, b);
  }

  const campaigns: CampaignRow[] = (camps ?? [])
    .map((c) => {
      const agg = byCamp.get(c.id) ?? { spend: 0, gmv: 0, orders: 0 };
      return {
        id: c.id,
        name: c.campaign_name,
        status: c.status,
        objective: c.objective,
        spend: +agg.spend.toFixed(2),
        gmv: +agg.gmv.toFixed(2),
        orders: agg.orders,
        roi: agg.spend > 0 ? +(agg.gmv / agg.spend).toFixed(2) : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  return {
    shop,
    windowDays,
    startDate: startDateStr,
    endDate: endDateStr,
    dailySeries,
    campaigns,
  };
}

/** 金额格式化:$12,345 */
export function formatUsd(value: number): string {
  if (value >= 10000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 数字格式化:1,234 */
export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

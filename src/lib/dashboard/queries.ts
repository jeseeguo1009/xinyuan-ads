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
  // 指标(窗口内聚合)
  spendCny: number;
  gmvCny: number;
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
    spendCny: number;
    gmvCny: number;
    orders: number;
    roi: number;
  };
  shops: ShopSummary[];
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
 * @param windowDays 统计窗口天数,默认 7 天
 */
export async function getDashboardData(windowDays = 7): Promise<DashboardData> {
  const supabase = createServiceRoleClient();
  const endDate = new Date();
  const startDate = subDays(endDate, windowDays - 1);
  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');

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
      totals: { spendCny: 0, gmvCny: 0, orders: 0, roi: 0 },
      shops: [],
    };
  }

  // 2. 拉窗口内所有日度指标
  const { data: metrics, error: metricsErr } = await supabase
    .schema('ads')
    .from('daily_metrics')
    .select('account_id, spend_cny, gmv_cny, orders, impressions, clicks')
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
    acc.spend += Number(m.spend_cny);
    acc.gmv += Number(m.gmv_cny);
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
      spendCny: +agg.spend.toFixed(2),
      gmvCny: +agg.gmv.toFixed(2),
      orders: agg.orders,
      impressions: agg.imp,
      clicks: agg.clk,
      roi: agg.spend > 0 ? +(agg.gmv / agg.spend).toFixed(2) : 0,
      ctr: agg.imp > 0 ? +(agg.clk / agg.imp).toFixed(4) : 0,
    };
  });

  // 5. 总计
  const totalSpend = shops.reduce((s, x) => s + x.spendCny, 0);
  const totalGmv = shops.reduce((s, x) => s + x.gmvCny, 0);
  const totalOrders = shops.reduce((s, x) => s + x.orders, 0);

  return {
    windowDays,
    startDate: startDateStr,
    endDate: endDateStr,
    totals: {
      spendCny: +totalSpend.toFixed(2),
      gmvCny: +totalGmv.toFixed(2),
      orders: totalOrders,
      roi: totalSpend > 0 ? +(totalGmv / totalSpend).toFixed(2) : 0,
    },
    shops,
  };
}

/** 金额格式化:¥12,345 */
export function formatCny(value: number): string {
  if (value >= 10000) {
    return `¥${(value / 10000).toFixed(1)}万`;
  }
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

/** 数字格式化:1,234 */
export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

/**
 * 日报生成器 —— 从 Supabase 拉数据 → 调 Claude → 返回 Markdown
 *
 * 被两个地方调用:
 *  1. Supabase Edge Function(定时每天 8:30)→ 生成 + 推飞书 + 缓存
 *  2. Next.js API Route(首页洞察面板 + 手动触发)→ 返回给前端
 */

import { subDays, format } from 'date-fns';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generate } from '@/lib/claude/client';
import {
  DAILY_REPORT_SYSTEM_PROMPT,
  buildDailyReportPrompt,
  type DailySnapshot,
  type ShopSnapshot,
} from '@/lib/claude/prompts/daily-report';

export interface DailyReportResult {
  /** 报告日期(yyyy-MM-dd) */
  reportDate: string;
  /** Claude 生成的 Markdown */
  markdown: string;
  /** 是否 mock 数据 */
  isMock: boolean;
  /** Token 使用量 */
  inputTokens?: number;
  outputTokens?: number;
  /** 生成耗时(ms) */
  durationMs: number;
}

// market 代码 → 中文 + emoji
const MARKET_INFO: Record<string, { country: string; flag: string }> = {
  TH: { country: '泰国', flag: '🇹🇭' },
  VN: { country: '越南', flag: '🇻🇳' },
  PH: { country: '菲律宾', flag: '🇵🇭' },
  MY: { country: '马来西亚', flag: '🇲🇾' },
  ID: { country: '印尼', flag: '🇮🇩' },
  SG: { country: '新加坡', flag: '🇸🇬' },
};

/** 聚合某一天的 metrics,返回 DailySnapshot */
async function aggregateDay(date: string): Promise<DailySnapshot> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('ads')
    .from('daily_metrics')
    .select('spend_cny, gmv_cny, orders, impressions, clicks')
    .eq('stat_date', date);
  if (error) throw error;

  const totals = (data ?? []).reduce(
    (acc, m) => ({
      spend: acc.spend + Number(m.spend_cny),
      gmv: acc.gmv + Number(m.gmv_cny),
      orders: acc.orders + m.orders,
      imp: acc.imp + Number(m.impressions),
      clk: acc.clk + Number(m.clicks),
    }),
    { spend: 0, gmv: 0, orders: 0, imp: 0, clk: 0 }
  );

  return {
    spendCny: +totals.spend.toFixed(2),
    gmvCny: +totals.gmv.toFixed(2),
    orders: totals.orders,
    impressions: totals.imp,
    clicks: totals.clk,
    roi: totals.spend > 0 ? +(totals.gmv / totals.spend).toFixed(2) : 0,
    ctr: totals.imp > 0 ? +(totals.clk / totals.imp).toFixed(4) : 0,
  };
}

/** 按店铺维度聚合昨日数据 */
async function aggregateShopsForDate(
  date: string,
  prevDate: string
): Promise<ShopSnapshot[]> {
  const supabase = createServiceRoleClient();

  const { data: accounts, error: accErr } = await supabase
    .schema('ads')
    .from('accounts')
    .select('id, market, operator_code')
    .eq('is_active', true);
  if (accErr) throw accErr;

  const { data: metrics, error: mErr } = await supabase
    .schema('ads')
    .from('daily_metrics')
    .select('account_id, stat_date, spend_cny, gmv_cny, orders')
    .in('stat_date', [date, prevDate]);
  if (mErr) throw mErr;

  const shops: ShopSnapshot[] = [];
  for (const acc of accounts ?? []) {
    const info = MARKET_INFO[acc.market] ?? { country: acc.market, flag: '🏳️' };

    const agg = { spend: 0, gmv: 0, orders: 0 };
    const prevAgg = { spend: 0, gmv: 0, orders: 0 };

    for (const m of metrics ?? []) {
      if (m.account_id !== acc.id) continue;
      const target = m.stat_date === date ? agg : prevAgg;
      target.spend += Number(m.spend_cny);
      target.gmv += Number(m.gmv_cny);
      target.orders += m.orders;
    }

    const roi = agg.spend > 0 ? agg.gmv / agg.spend : 0;
    const prevRoi = prevAgg.spend > 0 ? prevAgg.gmv / prevAgg.spend : 0;
    const delta = prevRoi > 0 ? ((roi - prevRoi) / prevRoi) * 100 : 0;

    shops.push({
      country: info.country,
      flag: info.flag,
      operatorCode: acc.operator_code ?? '-',
      spendCny: +agg.spend.toFixed(2),
      gmvCny: +agg.gmv.toFixed(2),
      orders: agg.orders,
      roi: +roi.toFixed(2),
      roiDeltaPct: +delta.toFixed(1),
    });
  }

  return shops;
}

/**
 * 生成日报
 * @param targetDate 目标日期,默认昨天
 */
export async function generateDailyReport(
  targetDate?: Date
): Promise<DailyReportResult> {
  const start = Date.now();

  // 默认"昨天"(注意:mock 数据的最新日期是今天,为了让日报有数据,这里用"今天"作为"报告日")
  const today = targetDate ?? new Date();
  const yesterday = subDays(today, 1);
  const dayBeforeYesterday = subDays(today, 2);
  const lastWeek = subDays(today, 7);

  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
  const dayBeforeStr = format(dayBeforeYesterday, 'yyyy-MM-dd');
  const lastWeekStr = format(lastWeek, 'yyyy-MM-dd');

  // 并行拉数据
  const [ySnap, dSnap, wSnap, shopBreakdown] = await Promise.all([
    aggregateDay(yesterdayStr),
    aggregateDay(dayBeforeStr),
    aggregateDay(lastWeekStr),
    aggregateShopsForDate(yesterdayStr, dayBeforeStr),
  ]);

  // 构造 prompt
  const prompt = buildDailyReportPrompt({
    reportDate: yesterdayStr,
    yesterday: ySnap,
    dayBefore: dSnap,
    lastWeek: wSnap,
    shopBreakdown,
  });

  // 调 Claude(mock 降级由 client 处理)
  const result = await generate({
    system: DAILY_REPORT_SYSTEM_PROMPT,
    prompt,
    maxTokens: 1500,
    temperature: 0.4,
  });

  return {
    reportDate: yesterdayStr,
    markdown: result.text,
    isMock: result.isMock,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: Date.now() - start,
  };
}

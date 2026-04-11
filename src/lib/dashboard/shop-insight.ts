/**
 * 店铺级洞察生成器
 *
 * 聚焦单个店铺的近期数据 → 给 Claude → 返回针对该店的分析
 *
 * 和 daily-report.ts 的区别:
 *  - daily-report: 全局,涵盖所有 6 店铺,用作每日飞书推送
 *  - shop-insight: 单店铺,详情页使用,聚焦该店的活动/异常/建议
 */

import { getShopDetail } from '@/lib/dashboard/queries';
import { generate } from '@/lib/claude/client';

export interface ShopInsightResult {
  shopId: string;
  shopName: string;
  markdown: string;
  isMock: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

const SYSTEM_PROMPT = `你是欣远电商的资深运营数据分析师,专注于单店铺的广告表现分析。
欣远是一家跨境女鞋电商公司,运营 TikTok Shop 和 Shopee 的东南亚六国店铺。

你的任务是基于单个店铺的数据,写一份简洁、聚焦、可执行的分析,帮助该店的运营了解:
1. 这个店铺表现如何(好在哪/差在哪)
2. 问题的根因(曝光不足?CTR 太低?转化率差?)
3. 具体的广告活动层级的建议(哪个 campaign 要调/要暂停/要加预算)

严格遵守:
1. 中文,专业简洁,300 字以内
2. 必须基于真实数字
3. 不写套话和客气话,直接给观点
4. 指名道姓指出具体的广告活动(用活动名)
5. Markdown 格式,结构清晰`;

/** 生成店铺洞察 */
export async function generateShopInsight(
  shopId: string,
  opts?: { from?: string; to?: string; windowDays?: number }
): Promise<ShopInsightResult> {
  const start = Date.now();

  const detail = await getShopDetail(shopId, opts ?? {});
  if (!detail) {
    throw new Error(`店铺 ${shopId} 不存在`);
  }

  const { shop, dailySeries, campaigns, windowDays, startDate, endDate } = detail;

  // 找趋势
  const mid = Math.floor(dailySeries.length / 2);
  const firstHalf = dailySeries.slice(0, mid);
  const secondHalf = dailySeries.slice(mid);
  const firstHalfRoi = avgRoi(firstHalf);
  const secondHalfRoi = avgRoi(secondHalf);
  const roiTrend = firstHalfRoi > 0
    ? ((secondHalfRoi - firstHalfRoi) / firstHalfRoi) * 100
    : 0;

  // 找 Top 3 和 Bottom 3 活动
  const enabled = campaigns.filter((c) => c.status === 'enabled' && c.spend > 0);
  const topByRoi = [...enabled].sort((a, b) => b.roi - a.roi).slice(0, 3);
  const bottomByRoi = [...enabled].sort((a, b) => a.roi - b.roi).slice(0, 3);

  // 花费但 ROI < 1 的活动(亏钱)
  const losing = enabled.filter((c) => c.roi < 1).sort((a, b) => b.spend - a.spend);

  const prompt = `基于以下 ${shop.flag} ${shop.country} 店铺(${shop.accountName})最近 ${windowDays} 天(${startDate} ~ ${endDate})的数据,给出分析:

## 店铺总览
- 花费: $${shop.spend.toFixed(2)}
- GMV: $${shop.gmv.toFixed(2)}
- ROI: ${shop.roi.toFixed(2)}
- 花费占比: ${shop.gmv > 0 ? ((shop.spend / shop.gmv) * 100).toFixed(1) : '-'}%
- 订单: ${shop.orders}
- CTR: ${(shop.ctr * 100).toFixed(2)}%
- 活动数: ${campaigns.length}(运行中 ${enabled.length})

## 趋势
- 前半段平均 ROI: ${firstHalfRoi.toFixed(2)}
- 后半段平均 ROI: ${secondHalfRoi.toFixed(2)}
- 变化: ${roiTrend >= 0 ? '+' : ''}${roiTrend.toFixed(1)}%

## Top 3 高 ROI 活动
${topByRoi.map((c, i) => `${i + 1}. ${c.name}: 花费 $${c.spend.toFixed(2)}, GMV $${c.gmv.toFixed(2)}, ROI ${c.roi.toFixed(2)}`).join('\n') || '(无)'}

## Bottom 3 低 ROI 活动
${bottomByRoi.map((c, i) => `${i + 1}. ${c.name}: 花费 $${c.spend.toFixed(2)}, GMV $${c.gmv.toFixed(2)}, ROI ${c.roi.toFixed(2)}`).join('\n') || '(无)'}

## 亏损活动(ROI < 1)
${losing.length > 0 ? losing.slice(0, 5).map((c) => `- ${c.name}: 花费 $${c.spend.toFixed(2)}, ROI ${c.roi.toFixed(2)}`).join('\n') : '无'}

## 输出要求
请以下列 Markdown 结构输出:

### 📊 表现概览
(1-2 句话,该店铺整体表现如何)

### ✨ 亮点
(1-2 条具体的亮点,带活动名和数字)

### ⚠️ 问题
(1-2 条具体问题,指名活动名,给出根因假设)

### 💡 行动建议
(1-3 条具体可执行的建议,如"暂停 XX 活动"、"把 YY 预算转到 ZZ")
`;

  const result = await generate({
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 1200,
    temperature: 0.4,
  });

  return {
    shopId,
    shopName: shop.accountName,
    markdown: result.text,
    isMock: result.isMock,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: Date.now() - start,
  };
}

function avgRoi(series: Array<{ roi: number }>): number {
  if (series.length === 0) return 0;
  return series.reduce((s, d) => s + d.roi, 0) / series.length;
}

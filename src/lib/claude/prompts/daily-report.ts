/**
 * 每日运营日报 Prompt 模板
 *
 * 参考 §9.4 任务 3.2 的模板要求:
 *  1. 核心指标 + 环比/同比
 *  2. 亮点 2-3 个
 *  3. 关注 2-3 个 + 归因
 *  4. 建议处理人(@运营 / @采购 / @产品)
 *  5. Markdown 格式,适合飞书展示
 */

export interface DailyReportInputs {
  /** 报告日期,如 '2026-04-10' */
  reportDate: string;
  /** 昨日数据 */
  yesterday: DailySnapshot;
  /** 前日数据 */
  dayBefore: DailySnapshot;
  /** 上周同期数据 */
  lastWeek: DailySnapshot;
  /** 店铺维度的昨日明细(最多 6 条) */
  shopBreakdown: ShopSnapshot[];
}

export interface DailySnapshot {
  spend: number;
  gmv: number;
  orders: number;
  roi: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface ShopSnapshot {
  country: string;
  flag: string;
  operatorCode: string;
  spend: number;
  gmv: number;
  orders: number;
  roi: number;
  /** 相对前一日 ROI 变化,百分比 */
  roiDeltaPct: number;
}

export const DAILY_REPORT_SYSTEM_PROMPT = `你是欣远电商的资深运营数据分析师。欣远是一家跨境女鞋电商公司,
在 TikTok Shop 和 Shopee 的东南亚六国市场运营。你的任务是基于运营数据写一份简洁有洞察力的中文日报,
帮助运营团队快速掌握昨日表现、发现问题、采取行动。

严格遵守:
1. 语言:中文,专业简洁,不要套话和客气话
2. 长度:控制在 500 字以内,飞书群容易阅读
3. 用数字支撑观点,不要空泛表述
4. 发现问题时给出可能的归因(曝光?CTR?转化率?)
5. 责任人用 @运营/@采购/@产品 格式,运营部门对 OP01-OP06 运营代码负责
6. 使用 Markdown 格式,标题/列表/加粗要用
7. 不编造数据,所有数字必须来自输入`;

/** 构造日报 Prompt */
export function buildDailyReportPrompt(inputs: DailyReportInputs): string {
  const { reportDate, yesterday, dayBefore, lastWeek, shopBreakdown } = inputs;

  const pctChange = (a: number, b: number): string => {
    if (b === 0) return 'N/A';
    const pct = ((a - b) / b) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  return `基于以下数据撰写 ${reportDate} 的运营日报:

## 昨日总览(${reportDate})
- 总花费: $${yesterday.spend.toFixed(2)}
- 总 GMV: $${yesterday.gmv.toFixed(2)}
- 订单数: ${yesterday.orders}
- ROI: ${yesterday.roi.toFixed(2)}
- 曝光: ${yesterday.impressions.toLocaleString('en-US')}
- 点击: ${yesterday.clicks.toLocaleString('en-US')}
- CTR: ${(yesterday.ctr * 100).toFixed(2)}%

## 环比(前日)
- 花费环比: ${pctChange(yesterday.spend, dayBefore.spend)}
- GMV 环比: ${pctChange(yesterday.gmv, dayBefore.gmv)}
- ROI 环比: ${pctChange(yesterday.roi, dayBefore.roi)}
- 订单环比: ${pctChange(yesterday.orders, dayBefore.orders)}

## 同比(上周同期)
- 花费同比: ${pctChange(yesterday.spend, lastWeek.spend)}
- GMV 同比: ${pctChange(yesterday.gmv, lastWeek.gmv)}
- ROI 同比: ${pctChange(yesterday.roi, lastWeek.roi)}

## 分店铺明细
${shopBreakdown
  .map(
    (s) =>
      `- ${s.flag} ${s.country}(${s.operatorCode}): 花费 $${s.spend.toFixed(2)}, GMV $${s.gmv.toFixed(2)}, ROI ${s.roi.toFixed(2)}(${pctChange(s.roi, s.roi / (1 + s.roiDeltaPct / 100))}), 订单 ${s.orders}`
  )
  .join('\n')}

## 输出要求
请按以下结构输出 Markdown:

### 📊 核心数据
(1-2 句话概括昨日整体表现)

### ✨ 亮点
(2-3 条,突出做得好的事,带数字)

### ⚠️ 关注
(2-3 条问题,带归因和建议处理人)

### 💡 行动建议
(1-2 条具体可执行的动作)
`;
}

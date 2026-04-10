/**
 * Supabase Edge Function: generate-daily-report
 *
 * 每天早上 8:30(北京时间)触发:
 *  1. 聚合昨日 / 前日 / 上周同期数据
 *  2. 调 Claude API 生成日报 Markdown
 *  3. 推送到飞书机器人
 *  4. (可选)缓存到 ads.daily_reports 表,前端可读
 *
 * 部署:
 *   supabase functions deploy generate-daily-report
 *
 * 定时(Supabase Dashboard → Database → Cron):
 *   SELECT cron.schedule('daily-report', '30 0 * * *',
 *     'SELECT net.http_post(url:=''https://<project>.functions.supabase.co/generate-daily-report'', ...)');
 *   (0:30 UTC = 08:30 北京时间)
 *
 * 注意:这份 Edge Function 使用 Deno,代码和 src/lib/dashboard/daily-report.ts 有部分重复
 *      目的是让 Next.js API Route(前端用)和 Edge Function(定时用)互相独立、不依赖
 *      真正复用的是 Prompt 模板逻辑(手工同步),数据聚合因运行时不同只能各写一份
 */

// @ts-expect-error Deno 运行时
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-expect-error Deno 运行时
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.30.1';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MARKET_INFO: Record<string, { country: string; flag: string }> = {
  TH: { country: '泰国', flag: '🇹🇭' },
  VN: { country: '越南', flag: '🇻🇳' },
  PH: { country: '菲律宾', flag: '🇵🇭' },
  MY: { country: '马来西亚', flag: '🇲🇾' },
  ID: { country: '印尼', flag: '🇮🇩' },
  SG: { country: '新加坡', flag: '🇸🇬' },
};

const SYSTEM_PROMPT = `你是欣远电商的资深运营数据分析师。欣远是一家跨境女鞋电商公司,
在 TikTok Shop 和 Shopee 的东南亚六国市场运营。你的任务是基于运营数据写一份简洁有洞察力的中文日报,
帮助运营团队快速掌握昨日表现、发现问题、采取行动。

严格遵守:
1. 语言:中文,专业简洁
2. 长度:500 字以内,适合飞书群阅读
3. 用数字支撑观点
4. 发现问题时归因到曝光/CTR/转化率
5. 责任人用 @运营/@采购/@产品,运营对应 OP01-OP06
6. 使用 Markdown 格式`;

function pctChange(a: number, b: number): string {
  if (b === 0) return 'N/A';
  const pct = ((a - b) / b) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function subDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return d;
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// @ts-expect-error Deno 全局
Deno.serve(async (req: Request) => {
  const start = Date.now();
  try {
    // @ts-expect-error Deno env
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // @ts-expect-error Deno env
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // @ts-expect-error Deno env
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    // @ts-expect-error Deno env
    const feishuUrl = Deno.env.get('FEISHU_WEBHOOK_URL');

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'ads' },
    });

    const today = new Date();
    const yesterday = toDateStr(subDays(today, 1));
    const dayBefore = toDateStr(subDays(today, 2));
    const lastWeek = toDateStr(subDays(today, 7));

    // 聚合昨日/前日/上周各总览
    async function aggregateDay(date: string) {
      const { data, error } = await supabase
        .from('daily_metrics')
        .select('spend_cny, gmv_cny, orders, impressions, clicks')
        .eq('stat_date', date);
      if (error) throw error;
      const t = (data ?? []).reduce(
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
        spendCny: +t.spend.toFixed(2),
        gmvCny: +t.gmv.toFixed(2),
        orders: t.orders,
        impressions: t.imp,
        clicks: t.clk,
        roi: t.spend > 0 ? +(t.gmv / t.spend).toFixed(2) : 0,
        ctr: t.imp > 0 ? +(t.clk / t.imp).toFixed(4) : 0,
      };
    }

    const [ySnap, dSnap, wSnap] = await Promise.all([
      aggregateDay(yesterday),
      aggregateDay(dayBefore),
      aggregateDay(lastWeek),
    ]);

    // 店铺明细
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, market, operator_code')
      .eq('is_active', true);
    const { data: shopMetrics } = await supabase
      .from('daily_metrics')
      .select('account_id, stat_date, spend_cny, gmv_cny, orders')
      .in('stat_date', [yesterday, dayBefore]);

    const shopBreakdown: string[] = [];
    for (const acc of accounts ?? []) {
      const info = MARKET_INFO[acc.market] ?? { country: acc.market, flag: '🏳️' };
      let spend = 0,
        gmv = 0,
        orders = 0,
        prevSpend = 0,
        prevGmv = 0;
      for (const m of shopMetrics ?? []) {
        if (m.account_id !== acc.id) continue;
        if (m.stat_date === yesterday) {
          spend += Number(m.spend_cny);
          gmv += Number(m.gmv_cny);
          orders += m.orders;
        } else {
          prevSpend += Number(m.spend_cny);
          prevGmv += Number(m.gmv_cny);
        }
      }
      const roi = spend > 0 ? gmv / spend : 0;
      const prevRoi = prevSpend > 0 ? prevGmv / prevSpend : 0;
      const delta = prevRoi > 0 ? ((roi - prevRoi) / prevRoi) * 100 : 0;
      shopBreakdown.push(
        `- ${info.flag} ${info.country}(${acc.operator_code ?? '-'}): 花费 ¥${spend.toFixed(0)}, GMV ¥${gmv.toFixed(0)}, ROI ${roi.toFixed(2)}(${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%), 订单 ${orders}`
      );
    }

    const userPrompt = `基于以下数据撰写 ${yesterday} 的运营日报:

## 昨日总览
- 总花费: ¥${ySnap.spendCny.toLocaleString('zh-CN')}
- 总 GMV: ¥${ySnap.gmvCny.toLocaleString('zh-CN')}
- 订单: ${ySnap.orders}
- ROI: ${ySnap.roi}
- 曝光: ${ySnap.impressions.toLocaleString('zh-CN')}
- 点击: ${ySnap.clicks.toLocaleString('zh-CN')}
- CTR: ${(ySnap.ctr * 100).toFixed(2)}%

## 环比(前日)
- 花费: ${pctChange(ySnap.spendCny, dSnap.spendCny)}
- GMV: ${pctChange(ySnap.gmvCny, dSnap.gmvCny)}
- ROI: ${pctChange(ySnap.roi, dSnap.roi)}

## 同比(上周同期)
- 花费: ${pctChange(ySnap.spendCny, wSnap.spendCny)}
- GMV: ${pctChange(ySnap.gmvCny, wSnap.gmvCny)}
- ROI: ${pctChange(ySnap.roi, wSnap.roi)}

## 分店铺明细
${shopBreakdown.join('\n')}

## 输出要求
### 📊 核心数据
### ✨ 亮点(2-3 条)
### ⚠️ 关注(2-3 条,带归因和责任人)
### 💡 行动建议(1-2 条)
`;

    let markdown: string;
    let isMock = false;
    if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const resp = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1500,
        temperature: 0.4,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const textBlock = resp.content.find((b: { type: string }) => b.type === 'text');
      markdown = textBlock && 'text' in textBlock ? (textBlock as { text: string }).text : '';
    } else {
      isMock = true;
      markdown = `## 📊 核心数据(MOCK)\n昨日总花费 ¥${ySnap.spendCny}, GMV ¥${ySnap.gmvCny}, ROI ${ySnap.roi}\n\n(ANTHROPIC_API_KEY 未配置)`;
    }

    // 推飞书
    if (feishuUrl) {
      const feishuBody = {
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: `📊 欣远广告日报 ${yesterday}` },
            template: 'blue',
          },
          elements: [{ tag: 'markdown', content: markdown }],
        },
      };
      await fetch(feishuUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feishuBody),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        reportDate: yesterday,
        isMock,
        durationMs: Date.now() - start,
        markdown,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[generate-daily-report] 失败:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

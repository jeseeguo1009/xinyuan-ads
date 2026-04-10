/**
 * Supabase Edge Function: fetch-exchange-rates
 *
 * 每天早上 6:00(北京时间)触发,拉取 6 币种对 CNY 的汇率,写入 ads.exchange_rates
 *
 * 数据源:exchangerate-api.com 免费版(1500 请求/月)
 *   EXCHANGE_RATE_API_KEY 未配置时降级到 open.er-api.com 无需 key 版
 *
 * 部署:
 *   supabase functions deploy fetch-exchange-rates
 *
 * 定时(在 Supabase Dashboard → Database → Cron 或 CLI):
 *   SELECT cron.schedule('fetch-rates-daily', '0 22 * * *',
 *     'SELECT net.http_post(url:=''https://<project>.functions.supabase.co/fetch-exchange-rates'', ...)');
 *   (22:00 UTC = 06:00 北京时间)
 */

// @ts-expect-error Deno 运行时,Next.js 构建不需要解析
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TARGET_CURRENCIES = ['THB', 'VND', 'PHP', 'MYR', 'IDR', 'SGD'];

interface RateRow {
  currency: string;
  rate_to_cny: number;
  rate_date: string;
  source: string;
}

async function fetchRatesWithKey(apiKey: string): Promise<Record<string, number>> {
  // exchangerate-api.com 以 CNY 为 base 一次返回所有目标币种
  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/CNY`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`exchangerate-api 请求失败: ${res.status}`);
  const json = await res.json();
  if (json.result !== 'success') throw new Error(`API 返回错误: ${json['error-type']}`);
  // conversion_rates: { THB: 5.0, VND: 3500, ... }(1 CNY = N 外币)
  // 我们要存的是"1 外币 = N CNY",所以取倒数
  const rates: Record<string, number> = {};
  for (const c of TARGET_CURRENCIES) {
    const r = json.conversion_rates[c];
    if (r && r > 0) rates[c] = 1 / r;
  }
  return rates;
}

async function fetchRatesNoKey(): Promise<Record<string, number>> {
  // open.er-api.com 无需 key 的降级
  const url = 'https://open.er-api.com/v6/latest/CNY';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open.er-api 请求失败: ${res.status}`);
  const json = await res.json();
  const rates: Record<string, number> = {};
  for (const c of TARGET_CURRENCIES) {
    const r = json.rates?.[c];
    if (r && r > 0) rates[c] = 1 / r;
  }
  return rates;
}

// @ts-expect-error Deno 全局
Deno.serve(async (req: Request) => {
  try {
    // @ts-expect-error Deno 环境变量
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // @ts-expect-error Deno 环境变量
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // @ts-expect-error Deno 环境变量
    const apiKey = Deno.env.get('EXCHANGE_RATE_API_KEY');

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'ads' },
    });

    let rates: Record<string, number>;
    let source: string;
    if (apiKey) {
      rates = await fetchRatesWithKey(apiKey);
      source = 'exchangerate-api';
    } else {
      rates = await fetchRatesNoKey();
      source = 'open.er-api';
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows: RateRow[] = Object.entries(rates).map(([currency, rate]) => ({
      currency,
      rate_to_cny: +rate.toFixed(6),
      rate_date: today,
      source,
    }));

    // upsert(同一天同币种只保留最新)
    const { error } = await supabase
      .from('exchange_rates')
      .upsert(rows, { onConflict: 'currency,rate_date' });
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, source, count: rows.length, rows }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[fetch-exchange-rates] 失败:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

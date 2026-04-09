/**
 * 种子数据脚本 —— 为 ads schema 生成 6 店铺 × 30 天的假数据
 *
 * 用途:Phase 2 看板雏形开发期间,让 UI 能看到真实业务感的数据,不用等 TikTok 审核
 *
 * 运行:
 *   npx tsx scripts/seed-mock-data.ts              # 追加 mock 数据(不清空旧数据)
 *   npx tsx scripts/seed-mock-data.ts --reset      # 先清空所有 [MOCK] 账户,再插入
 *
 * 区分真假数据的方式:
 *   - mock 账户的 account_name 以 "[MOCK]" 开头
 *   - external_account_id 以 "mock-" 开头
 *   - 真实数据走 TikTok OAuth 流程写入,不会带这些前缀
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { addDays, format, subDays } from 'date-fns';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- 读取 .env.local ----------
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local 不存在,无法读取 Supabase 配置');
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0 && !process.env[key]) {
      process.env[key] = rest.join('=');
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    '缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY,请检查 .env.local'
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'ads' },
});

// ---------- 常量:店铺定义 ----------
interface ShopDef {
  market: 'TH' | 'VN' | 'PH' | 'MY' | 'ID' | 'SG';
  country: string;
  currency: string;
  timezone: string;
  operator: string;
  rateToCny: number; // 1 单位本币 ≈ X 人民币
}

const SHOPS: ShopDef[] = [
  { market: 'TH', country: '泰国',     currency: 'THB', timezone: 'Asia/Bangkok',      operator: 'OP01', rateToCny: 0.2000 },
  { market: 'VN', country: '越南',     currency: 'VND', timezone: 'Asia/Ho_Chi_Minh',  operator: 'OP02', rateToCny: 0.000290 },
  { market: 'PH', country: '菲律宾',   currency: 'PHP', timezone: 'Asia/Manila',       operator: 'OP03', rateToCny: 0.1300 },
  { market: 'MY', country: '马来西亚', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', operator: 'OP04', rateToCny: 1.5500 },
  { market: 'ID', country: '印尼',     currency: 'IDR', timezone: 'Asia/Jakarta',      operator: 'OP05', rateToCny: 0.000450 },
  { market: 'SG', country: '新加坡',   currency: 'SGD', timezone: 'Asia/Singapore',    operator: 'OP06', rateToCny: 5.3000 },
];

// ---------- SKU 池(符合 §11 决策 8 格式) ----------
// 结构:WS-HH-PS-03-25001-BK-38
const SKU_POOL = [
  'WS-HH-PS-03-25001-BK-38',
  'WS-HH-PS-03-25001-WH-37',
  'WS-HH-PS-03-25002-RD-38',
  'WS-HH-PS-03-25003-BK-36',
  'WS-HH-BT-03-25004-BN-39',
  'WS-HH-BT-03-25005-BK-38',
  'WS-HH-SN-02-25006-WH-37',
  'WS-HH-SN-02-25007-PK-36',
  'WS-HH-SN-02-25008-BK-38',
  'WS-HH-SD-01-25009-BN-39',
  'WS-HH-SD-01-25010-BK-38',
  'WS-HH-PS-03-25011-RD-37',
  'WS-HH-PS-03-25012-WH-38',
  'WS-HH-BT-04-25013-BK-40',
  'WS-HH-BT-04-25014-BN-39',
  'WS-HH-SN-02-25015-PK-37',
  'WS-HH-SN-02-25016-WH-36',
  'WS-HH-FT-03-25017-BK-38',
  'WS-HH-FT-03-25018-RD-39',
  'WS-HH-FT-03-25019-BK-37',
];

const OBJECTIVES = ['product_sales', 'traffic', 'video_views', 'live_room_promotion'] as const;

// ---------- 工具函数 ----------
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => Math.random() * (max - min) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/** 对数正态分布,生成曝光量这种偏态数据 */
function logNormal(mean: number, sigma: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(Math.log(mean) + sigma * z);
}

/** 给一个广告生成一天的指标,基于 ad 的"基线"和当日波动 */
function generateDayMetrics(
  baseRoi: number,
  baseImpressions: number,
  baseCtr: number,
  baseCvr: number,
  localCurrencyFactor: number, // 不同币种单价差异:越南/印尼单价高,数值大
  rateToCny: number,
  isAnomaly: boolean
) {
  // 当日波动(±20% 随机)
  let roiMul = randFloat(0.85, 1.15);
  let impMul = randFloat(0.75, 1.3);
  let ctrMul = randFloat(0.8, 1.25);
  let cvrMul = randFloat(0.8, 1.2);

  // 异常日:ROI 突降 50%+
  if (isAnomaly) {
    roiMul *= randFloat(0.25, 0.5);
    ctrMul *= randFloat(0.5, 0.8);
  }

  const impressions = Math.max(100, Math.round(logNormal(baseImpressions, 0.25) * impMul));
  const ctr = Math.max(0.001, baseCtr * ctrMul);
  const clicks = Math.max(1, Math.round(impressions * ctr));
  const cvr = Math.max(0.005, baseCvr * cvrMul);
  const orders = Math.max(0, Math.round(clicks * cvr));
  const units = orders === 0 ? 0 : orders + randInt(0, 2);

  // 单次点击花费(本币):低币值国家(VND/IDR)CPC 数字大
  const cpcLocal = randFloat(0.5, 3.0) * localCurrencyFactor;
  const spendLocal = +(clicks * cpcLocal).toFixed(4);
  const spendCny = +(spendLocal * rateToCny).toFixed(4);

  const roi = baseRoi * roiMul;
  const gmvCny = +(spendCny * roi).toFixed(4);
  const gmvLocal = +(gmvCny / rateToCny).toFixed(4);

  // 衍生指标
  const cpcCny = clicks > 0 ? +(spendCny / clicks).toFixed(4) : 0;
  const cpmCny = impressions > 0 ? +((spendCny / impressions) * 1000).toFixed(4) : 0;
  const cpaCny = orders > 0 ? +(spendCny / orders).toFixed(4) : 0;

  return {
    impressions,
    clicks,
    spend_local: spendLocal,
    spend_cny: spendCny,
    exchange_rate: rateToCny,
    orders,
    units_sold: units,
    gmv_local: gmvLocal,
    gmv_cny: gmvCny,
    ctr: +ctr.toFixed(6),
    cpc_cny: cpcCny,
    cpm_cny: cpmCny,
    cvr: +cvr.toFixed(6),
    roi: +roi.toFixed(4),
    cpa_cny: cpaCny,
  };
}

// ---------- 清理旧 mock 数据 ----------
async function resetMockData() {
  console.log('🧹 清空旧的 [MOCK] 数据...');
  // 找到所有 mock 账户
  const { data: mockAccounts, error } = await supabase
    .from('accounts')
    .select('id')
    .like('external_account_id', 'mock-%');
  if (error) throw error;

  if (mockAccounts && mockAccounts.length > 0) {
    const ids = mockAccounts.map((a) => a.id);
    // 级联删除(外键 ON DELETE CASCADE 会带走 campaigns/ad_groups/ads/daily_metrics)
    const { error: delErr } = await supabase.from('accounts').delete().in('id', ids);
    if (delErr) throw delErr;
    console.log(`   已删除 ${ids.length} 个 mock 账户及其级联数据`);
  } else {
    console.log('   无旧 mock 数据');
  }

  // 清空 mock 汇率(source = 'mock-seed')
  const { error: rateErr } = await supabase
    .from('exchange_rates')
    .delete()
    .eq('source', 'mock-seed');
  if (rateErr) throw rateErr;
}

// ---------- 插入 accounts ----------
async function insertAccounts() {
  console.log('📦 插入 6 个 mock 账户...');
  const rows = SHOPS.map((shop) => ({
    platform: 'tiktok_shop' as const,
    market: shop.market,
    external_account_id: `mock-${shop.market.toLowerCase()}-001`,
    external_shop_id: `mock-shop-${shop.market.toLowerCase()}`,
    account_name: `[MOCK] 欣远-${shop.country}-TikTok`,
    currency: shop.currency,
    timezone: shop.timezone,
    operator_code: shop.operator,
    is_active: true,
  }));

  const { data, error } = await supabase.from('accounts').insert(rows).select('id, market');
  if (error) throw error;
  console.log(`   ✅ ${data!.length} 个账户已插入`);
  return data!;
}

// ---------- 插入 campaigns / ad_groups / ads ----------
interface AdSpec {
  id: string;
  accountId: string;
  shop: ShopDef;
  baseRoi: number;
  baseImpressions: number;
  baseCtr: number;
  baseCvr: number;
  anomalyDays: Set<string>; // 哪几天是异常日
}

async function insertAdHierarchy(
  accounts: { id: string; market: string }[]
): Promise<AdSpec[]> {
  console.log('📦 插入 campaigns / ad_groups / ads...');
  const allAds: AdSpec[] = [];
  let campCount = 0;
  let groupCount = 0;
  let adCount = 0;

  for (const acc of accounts) {
    const shop = SHOPS.find((s) => s.market === acc.market)!;

    // 每个店铺 5-8 个 campaign
    const numCamps = randInt(5, 8);
    const campRows = Array.from({ length: numCamps }, (_, i) => ({
      account_id: acc.id,
      external_campaign_id: `mock-camp-${acc.market}-${i + 1}`,
      campaign_name: `${shop.country}春季爆款-${i + 1}`,
      objective: pick(OBJECTIVES),
      status: Math.random() < 0.85 ? ('enabled' as const) : ('paused' as const),
      budget: randInt(500, 5000),
      budget_type: 'daily',
      start_time: subDays(new Date(), 60).toISOString(),
    }));
    const { data: camps, error: campErr } = await supabase
      .from('campaigns')
      .insert(campRows)
      .select('id');
    if (campErr) throw campErr;
    campCount += camps!.length;

    for (let ci = 0; ci < camps!.length; ci++) {
      const campId = camps![ci]!.id;

      // 每个 campaign 2-3 个 ad_group
      const numGroups = randInt(2, 3);
      const groupRows = Array.from({ length: numGroups }, (_, gi) => ({
        campaign_id: campId,
        external_ad_group_id: `mock-ag-${acc.market}-${ci + 1}-${gi + 1}`,
        ad_group_name: `定向组-${gi + 1}`,
        status: 'enabled' as const,
        bid_amount: randFloat(0.3, 2.5),
        bid_type: 'cpc',
        targeting: { age: '18-34', gender: 'female', location: shop.country },
      }));
      const { data: groups, error: gErr } = await supabase
        .from('ad_groups')
        .insert(groupRows)
        .select('id');
      if (gErr) throw gErr;
      groupCount += groups!.length;

      for (const g of groups!) {
        // 每个 ad_group 2-3 个 ad
        const numAds = randInt(2, 3);
        const adRows = Array.from({ length: numAds }, (_, ai) => ({
          ad_group_id: g.id,
          external_ad_id: `mock-ad-${acc.market}-${ci}-${ai}-${Math.random().toString(36).slice(2, 8)}`,
          ad_name: `创意-${ai + 1}`,
          status: 'enabled' as const,
          sku_code: pick(SKU_POOL),
          creative_type: Math.random() < 0.7 ? 'video' : 'image',
        }));
        const { data: ads, error: adErr } = await supabase
          .from('ads')
          .insert(adRows)
          .select('id');
        if (adErr) throw adErr;
        adCount += ads!.length;

        for (const ad of ads!) {
          // 为每个 ad 生成基线特征
          const baseRoi = randFloat(1.5, 4.0);
          const baseImpressions = randInt(2000, 20000);
          const baseCtr = randFloat(0.008, 0.035);
          const baseCvr = randFloat(0.02, 0.08);

          // 10% 概率会有 1-2 个异常日
          const anomalyDays = new Set<string>();
          if (Math.random() < 0.1) {
            const numAnomaly = randInt(1, 2);
            for (let a = 0; a < numAnomaly; a++) {
              const dayOffset = randInt(0, 29);
              anomalyDays.add(format(subDays(new Date(), dayOffset), 'yyyy-MM-dd'));
            }
          }

          allAds.push({
            id: ad.id,
            accountId: acc.id,
            shop,
            baseRoi,
            baseImpressions,
            baseCtr,
            baseCvr,
            anomalyDays,
          });
        }
      }
    }
  }

  console.log(`   ✅ ${campCount} campaigns / ${groupCount} ad_groups / ${adCount} ads`);
  return allAds;
}

// ---------- 插入 30 天日度指标 ----------
async function insertDailyMetrics(allAds: AdSpec[]) {
  console.log(`📦 生成 30 天日度指标(${allAds.length} 个 ad × 30 天)...`);
  const rows: Record<string, unknown>[] = [];
  const today = new Date();

  for (const ad of allAds) {
    // 货币因子:让不同币种的 spend_local 数字符合直觉
    // CNY=1, THB≈5, VND≈3500, PHP≈7.5, MYR≈0.65, IDR≈2200, SGD≈0.19
    const localFactor = 1 / ad.shop.rateToCny / 10;

    // 为了让 campaign/ad_group 维度的数据也能聚合对,先找上级 id
    // 这里偷懒:后面查一次 ads 表拿 ad_group_id,太贵了。
    // 更简单:insert 的时候只记 ad_id,campaign_id/ad_group_id 留空,看板查询时 join
    // 但 schema 上这几个字段是可空的(没有 NOT NULL),OK。

    for (let d = 29; d >= 0; d--) {
      const date = subDays(today, d);
      const dateStr = format(date, 'yyyy-MM-dd');
      const isAnomaly = ad.anomalyDays.has(dateStr);

      const m = generateDayMetrics(
        ad.baseRoi,
        ad.baseImpressions,
        ad.baseCtr,
        ad.baseCvr,
        localFactor,
        ad.shop.rateToCny,
        isAnomaly
      );

      rows.push({
        account_id: ad.accountId,
        ad_id: ad.id,
        stat_date: dateStr,
        data_source: 'mock',
        ...m,
      });
    }
  }

  // 分批插入,避免单次超限
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('daily_metrics').insert(chunk);
    if (error) throw error;
    process.stdout.write(`   进度 ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log(`\n   ✅ ${rows.length} 行 daily_metrics 已插入`);
}

// ---------- 插入汇率 ----------
async function insertExchangeRates() {
  console.log('📦 插入 30 天汇率...');
  const rows: Record<string, unknown>[] = [];
  const today = new Date();
  for (const shop of SHOPS) {
    for (let d = 29; d >= 0; d--) {
      // 每日 ±0.3% 浮动
      const jitter = randFloat(0.997, 1.003);
      rows.push({
        currency: shop.currency,
        rate_to_cny: +(shop.rateToCny * jitter).toFixed(6),
        rate_date: format(subDays(today, d), 'yyyy-MM-dd'),
        source: 'mock-seed',
      });
    }
  }
  const { error } = await supabase.from('exchange_rates').insert(rows);
  if (error) throw error;
  console.log(`   ✅ ${rows.length} 行汇率已插入`);
}

// ---------- 主流程 ----------
async function main() {
  const shouldReset = process.argv.includes('--reset');
  console.log('🚀 欣远广告 Agent - 种子数据脚本');
  console.log(`   目标:${SUPABASE_URL}`);
  console.log(`   模式:${shouldReset ? '--reset(先清空再插入)' : '追加'}`);
  console.log('');

  if (shouldReset) {
    await resetMockData();
  }

  const accounts = await insertAccounts();
  const allAds = await insertAdHierarchy(accounts);
  await insertDailyMetrics(allAds);
  await insertExchangeRates();

  console.log('');
  console.log('🎉 Seed 完成!');
  console.log('   下一步:刷新 https://xinyuan-ads.netlify.app 首页应该能看到 6 个店铺');
}

main().catch((err) => {
  console.error('❌ 脚本执行失败:', err);
  process.exit(1);
});

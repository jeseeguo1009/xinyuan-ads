/**
 * 测试 TikTok Business API 连通性
 *
 * 用法:
 *   npx tsx scripts/test-business-api.ts
 *
 * 需要 .env.local 里配置:
 *   TIKTOK_BUSINESS_ACCESS_TOKEN
 *   TIKTOK_BUSINESS_ADVERTISER_ID
 */

import 'dotenv/config';

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

async function main() {
  const token = process.env.TIKTOK_BUSINESS_ACCESS_TOKEN;
  const advId = process.env.TIKTOK_BUSINESS_ADVERTISER_ID;

  if (!token || !advId) {
    console.error('❌ 请先在 .env.local 配置 TIKTOK_BUSINESS_ACCESS_TOKEN 和 TIKTOK_BUSINESS_ADVERTISER_ID');
    process.exit(1);
  }

  console.log(`📡 测试 Business API 连通性...`);
  console.log(`   Advertiser ID: ${advId}`);
  console.log(`   Token: ${token.slice(0, 10)}...${token.slice(-4)}`);
  console.log('');

  // 测试 1: 获取广告主信息
  console.log('1️⃣  获取广告主信息...');
  try {
    const url = `${API_BASE}/advertiser/info/?advertiser_ids=["${advId}"]`;
    const res = await fetch(url, {
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (json.code === 0) {
      const info = json.data?.list?.[0];
      console.log(`   ✅ 广告主名称: ${info?.name ?? '未知'}`);
      console.log(`   ✅ 币种: ${info?.currency ?? '未知'}`);
      console.log(`   ✅ 时区: ${info?.timezone ?? '未知'}`);
    } else {
      console.log(`   ❌ 错误 code=${json.code}: ${json.message}`);
    }
  } catch (err) {
    console.log(`   ❌ 请求失败: ${err}`);
  }

  // 测试 2: 获取 campaign 列表
  console.log('\n2️⃣  获取广告活动列表...');
  try {
    const url = `${API_BASE}/campaign/get/?advertiser_id=${advId}&page_size=5`;
    const res = await fetch(url, {
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (json.code === 0) {
      const total = json.data?.page_info?.total_number ?? 0;
      const list = json.data?.list ?? [];
      console.log(`   ✅ 共 ${total} 个广告活动`);
      for (const c of list.slice(0, 3)) {
        console.log(`   - ${c.campaign_name} (${c.objective_type}, ${c.status})`);
      }
    } else {
      console.log(`   ❌ 错误 code=${json.code}: ${json.message}`);
    }
  } catch (err) {
    console.log(`   ❌ 请求失败: ${err}`);
  }

  // 测试 3: 获取今天的报表（如果有广告活动）
  console.log('\n3️⃣  获取最近 7 天报表...');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await fetch(`${API_BASE}/report/integrated/get/`, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advertiser_id: advId,
        report_type: 'BASIC',
        dimensions: ['stat_time_day'],
        data_level: 'AUCTION_ADVERTISER',
        start_date: weekAgo,
        end_date: today,
        metrics: ['spend', 'impressions', 'clicks', 'complete_payment', 'total_onsite_shopping_value'],
      }),
    });
    const json = await res.json();
    if (json.code === 0) {
      const list = json.data?.list ?? [];
      console.log(`   ✅ 获取到 ${list.length} 天的数据`);
      for (const row of list) {
        const d = row.dimensions?.stat_time_day;
        const m = row.metrics;
        console.log(`   ${d}: 花费=${m.spend} 展现=${m.impressions} 点击=${m.clicks} 订单=${m.complete_payment} GMV=${m.total_onsite_shopping_value}`);
      }
    } else {
      console.log(`   ❌ 错误 code=${json.code}: ${json.message}`);
    }
  } catch (err) {
    console.log(`   ❌ 请求失败: ${err}`);
  }

  console.log('\n🏁 测试完成');
}

main();

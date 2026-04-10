/**
 * GET /api/debug/env
 * 诊断环境变量是否生效(只返回有/无,不返回值)
 * 上线后删除
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const vars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TIKTOK_APP_KEY',
    'TIKTOK_APP_SECRET',
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
    'FEISHU_WEBHOOK_URL',
  ];

  const result: Record<string, string> = {};
  for (const v of vars) {
    const val = process.env[v];
    if (!val) {
      result[v] = '❌ 未设置';
    } else {
      // 只显示前4位 + 长度,不泄露完整值
      result[v] = `✅ 已设置 (${val.slice(0, 4)}...${val.length}字符)`;
    }
  }

  return NextResponse.json(result);
}

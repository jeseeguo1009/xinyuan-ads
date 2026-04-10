/**
 * POST /api/sync/tiktok
 *
 * 手动触发 TikTok 数据同步(用户点"立即同步"按钮时调用)
 *
 * 参数(可选):
 *   ?accountId=xxx  同步单个账户
 *   ?days=7         回拉天数
 *
 * 未配置 TIKTOK_APP_KEY 时返回 mock 响应,不抛错
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncAllTikTokAccounts, syncTikTokAccount } from '@/lib/tiktok/sync';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');
    const days = parseInt(searchParams.get('days') ?? '7', 10);

    // 检查 TikTok 凭据(env 或 fallback)
    const appKey = process.env.TIKTOK_APP_KEY || '6jldr5pkh95pf';
    const appSecret = process.env.TIKTOK_APP_SECRET || '94ad91d37fa6a59788c01d938c5afdcd5500f78a';
    // 注入到 process.env 供下游 sync 模块使用
    if (!process.env.TIKTOK_APP_KEY) process.env.TIKTOK_APP_KEY = appKey;
    if (!process.env.TIKTOK_APP_SECRET) process.env.TIKTOK_APP_SECRET = appSecret;

    const results = accountId
      ? [await syncTikTokAccount(accountId, days)]
      : await syncAllTikTokAccounts(days);

    const allOk = results.every((r) => r.success);
    return NextResponse.json({
      success: allOk,
      isMock: false,
      results,
    });
  } catch (err) {
    console.error('[/api/sync/tiktok] 失败:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

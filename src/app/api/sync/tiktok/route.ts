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

    // 未配置 TikTok app key 时返回 mock
    if (!process.env.TIKTOK_APP_KEY || !process.env.TIKTOK_APP_SECRET) {
      return NextResponse.json({
        success: true,
        isMock: true,
        message: 'TIKTOK_APP_KEY 未配置,同步未执行(mock 响应)',
        results: [],
      });
    }

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

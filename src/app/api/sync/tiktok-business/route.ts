/**
 * POST /api/sync/tiktok-business
 *
 * 手动触发 TikTok Business API 广告数据同步
 *
 * 参数(可选):
 *   ?days=7  回拉天数
 *
 * 需要环境变量:
 *   TIKTOK_BUSINESS_ACCESS_TOKEN - Business API 访问令牌
 *   TIKTOK_BUSINESS_ADVERTISER_ID - 广告主 ID
 *
 * 未配置时返回提示,不抛错
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncBusinessAccount } from '@/lib/tiktok/business-sync';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const accessToken = process.env.TIKTOK_BUSINESS_ACCESS_TOKEN;
    const advertiserId = process.env.TIKTOK_BUSINESS_ADVERTISER_ID;

    if (!accessToken || !advertiserId) {
      return NextResponse.json({
        success: false,
        isMock: true,
        message: '请先配置 TIKTOK_BUSINESS_ACCESS_TOKEN 和 TIKTOK_BUSINESS_ADVERTISER_ID',
        help: '方式一: 从 TikTok Business Center 开发者后台生成长期 token\n方式二: 访问 /api/auth/tiktok-business/authorize 走 OAuth 授权',
      });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') ?? '7', 10);

    const result = await syncBusinessAccount(accessToken, advertiserId, undefined, days);

    return NextResponse.json({
      success: result.success,
      isMock: false,
      result,
    });
  } catch (err) {
    console.error('[/api/sync/tiktok-business] 失败:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

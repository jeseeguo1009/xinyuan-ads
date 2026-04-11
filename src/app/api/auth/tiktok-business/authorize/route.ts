/**
 * GET /api/auth/tiktok-business/authorize
 *
 * 发起 TikTok Business API OAuth 授权流程
 * 用于获取广告数据(GMV Max 等)的访问权限
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TikTokBusinessClient } from '@/lib/tiktok/business-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const appId = process.env.TIKTOK_BUSINESS_APP_ID;
    if (!appId) {
      return NextResponse.json(
        { error: 'TIKTOK_BUSINESS_APP_ID 未配置' },
        { status: 500 }
      );
    }

    const redirectUri =
      process.env.TIKTOK_BUSINESS_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok-business/callback`;

    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set('tiktok_business_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    });

    const authorizeUrl = TikTokBusinessClient.buildAuthorizeUrl(
      appId,
      redirectUri,
      state
    );

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[TikTok Business Authorize Error]', error);
    return NextResponse.json(
      { error: '发起授权失败', details: String(error) },
      { status: 500 }
    );
  }
}

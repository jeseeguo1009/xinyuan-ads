/**
 * GET /api/auth/tiktok/authorize
 *
 * 发起 TikTok OAuth 授权流程
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const TIKTOK_AUTH_BASE = 'https://auth.tiktok-shops.com';

export async function GET() {
  try {
    // 直接在这里读环境变量,不经过 auth.ts
    const appKey = process.env.TIKTOK_APP_KEY;

    console.log('[TikTok Authorize] env check:', {
      hasAppKey: !!appKey,
      appKeyLength: appKey?.length,
      appKeyPrefix: appKey?.slice(0, 4),
    });

    if (!appKey) {
      // 返回诊断信息,看看到底能读到什么
      const allKeys = Object.keys(process.env)
        .filter((k) => k.includes('TIKTOK') || k.includes('tiktok'))
        .join(', ');
      return NextResponse.json(
        {
          error: '发起授权失败',
          details: 'TIKTOK_APP_KEY 未配置',
          debug: {
            envKeysWithTiktok: allKeys || '(无)',
            totalEnvKeys: Object.keys(process.env).length,
          },
        },
        { status: 500 }
      );
    }

    // 生成 state
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set('tiktok_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    });

    // 构造授权 URL
    const params = new URLSearchParams({
      app_key: appKey,
      state,
    });
    const authorizeUrl = `${TIKTOK_AUTH_BASE}/oauth/authorize?${params.toString()}`;

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[TikTok Authorize Error]', error);
    return NextResponse.json(
      { error: '发起授权失败', details: String(error) },
      { status: 500 }
    );
  }
}

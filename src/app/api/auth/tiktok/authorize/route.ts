/**
 * GET /api/auth/tiktok/authorize
 *
 * 发起 TikTok OAuth 授权流程
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const TIKTOK_AUTH_BASE = 'https://auth.tiktok-shops.com';

// App Key 不是敏感信息(授权 URL 里本来就可见),直接内联
// App Secret 才需要保密(仅在 callback 换 token 时使用)
const APP_KEY = process.env.TIKTOK_APP_KEY || '6jldr5pkh95pf';

export async function GET() {
  try {
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set('tiktok_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    });

    const params = new URLSearchParams({
      app_key: APP_KEY,
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

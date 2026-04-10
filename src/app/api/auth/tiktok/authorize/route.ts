/**
 * GET /api/auth/tiktok/authorize
 *
 * 作用:发起 TikTok OAuth 授权流程
 * 访问此接口会:
 *  1. 生成一个随机 state 存到 cookie(防 CSRF)
 *  2. 跳转到 TikTok 授权页
 *
 * 使用方式:
 *   前端放一个按钮 <a href="/api/auth/tiktok/authorize">连接 TikTok 店铺</a>
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildAuthorizeUrl, generateState } from '@/lib/tiktok/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[TikTok Authorize] TIKTOK_APP_KEY exists:', !!process.env.TIKTOK_APP_KEY);

    // 1. 生成 state 并存入 cookie
    const state = generateState();
    const cookieStore = await cookies();

    cookieStore.set('tiktok_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 分钟
      path: '/',
    });

    // 2. 构造授权 URL 并重定向
    const authorizeUrl = buildAuthorizeUrl(state);
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('[TikTok Authorize Error]', error);
    return NextResponse.json(
      { error: '发起授权失败', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/tiktok-business/callback
 *
 * TikTok Business API OAuth 回调:
 *  1. 校验 state
 *  2. 用 auth_code 换 access_token（Business API 的 token 长期有效）
 *  3. 拿到 advertiser_ids 列表
 *  4. 为每个 advertiser_id 创建/更新 ads.accounts 记录
 *  5. 重定向到 /auth/result
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TikTokBusinessClient } from '@/lib/tiktok/business-api';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('auth_code');
  const state = searchParams.get('state');

  const resultUrl = (status: 'success' | 'error', message: string) =>
    NextResponse.redirect(
      `${origin}/auth/result?status=${status}&message=${encodeURIComponent(message)}`
    );

  try {
    if (!code) return resultUrl('error', '缺少授权码(auth_code)');
    if (!state) return resultUrl('error', '缺少 state 参数');

    // state 校验
    const cookieStore = await cookies();
    const savedState = cookieStore.get('tiktok_business_state')?.value;
    if (savedState && savedState !== state) {
      return resultUrl('error', 'state 校验失败');
    }
    try { cookieStore.delete('tiktok_business_state'); } catch { /* 忽略 */ }

    const appId = process.env.TIKTOK_BUSINESS_APP_ID;
    const secret = process.env.TIKTOK_BUSINESS_SECRET;
    if (!appId || !secret) {
      return resultUrl('error', 'TIKTOK_BUSINESS_APP_ID 或 TIKTOK_BUSINESS_SECRET 未配置');
    }

    // 1. 换 token
    const tokenResult = await TikTokBusinessClient.exchangeCodeForToken(
      appId,
      secret,
      code
    );

    // 2. 为每个 advertiser_id 创建账户记录
    const supabase = createServiceRoleClient();
    const createdAccounts: string[] = [];

    for (const advId of tokenResult.advertiser_ids) {
      const { error } = await supabase
        .schema('ads')
        .from('accounts')
        .upsert(
          {
            platform: 'tiktok_shop',
            market: 'ALL', // Business API 广告账户可能跨市场
            external_account_id: `business-${advId}`,
            account_name: `TikTok Ads ${advId}`,
            access_token: tokenResult.access_token,
            // Business API token 长期有效,设一个远期过期时间
            token_expires_at: new Date(
              Date.now() + 365 * 24 * 3600 * 1000
            ).toISOString(),
            currency: 'USD', // 后续从 API 获取真实货币
            timezone: 'UTC',
            is_active: true,
            meta: { type: 'business_api', advertiser_id: advId },
          },
          { onConflict: 'platform,external_account_id' }
        );

      if (error) {
        console.error(`[TikTok Business Callback] 写库失败 ${advId}:`, error);
      } else {
        createdAccounts.push(advId);
      }
    }

    if (createdAccounts.length === 0) {
      return resultUrl('error', '没有获取到任何广告账户');
    }

    return resultUrl(
      'success',
      `Business API 授权成功,${createdAccounts.length} 个广告账户: ${createdAccounts.join(', ')}`
    );
  } catch (error) {
    console.error('[TikTok Business Callback Error]', error);
    return resultUrl('error', String(error));
  }
}

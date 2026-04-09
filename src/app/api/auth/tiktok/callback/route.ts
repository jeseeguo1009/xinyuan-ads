/**
 * GET /api/auth/tiktok/callback
 *
 * 作用:TikTok OAuth 回调处理
 * TikTok 授权成功后会带着 ?code=xxx&state=xxx 重定向到这里,流程:
 *  1. 校验 state(防 CSRF)
 *  2. 用 auth_code 换 access_token
 *  3. 把 token 写入 ads.accounts 表(upsert)
 *  4. 重定向到 /auth/result 显示结果
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForToken } from '@/lib/tiktok/auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const resultUrl = (status: 'success' | 'error', message: string) =>
    NextResponse.redirect(
      `${origin}/auth/result?status=${status}&message=${encodeURIComponent(message)}`
    );

  try {
    // 1. 基本参数校验
    if (!code) {
      return resultUrl('error', '缺少授权码(code)');
    }
    if (!state) {
      return resultUrl('error', '缺少 state 参数');
    }

    // 2. 校验 state 防 CSRF
    const cookieStore = await cookies();
    const savedState = cookieStore.get('tiktok_oauth_state')?.value;
    if (!savedState || savedState !== state) {
      return resultUrl('error', 'state 校验失败,可能是 CSRF 攻击或会话已过期');
    }
    // 用过即删
    cookieStore.delete('tiktok_oauth_state');

    // 3. 用 auth_code 换 token
    const token = await exchangeCodeForToken(code);

    // 4. 写入 ads.accounts(upsert:同一个 shop 再次授权时更新 token)
    const supabase = createServiceRoleClient();

    // 注:currency/market/timezone 在授权阶段无法确定(TikTok 返回里没这些),
    // 先占位,后续拉取店铺资料或首次同步时再补齐。
    const externalAccountId = token.open_id;
    const accountName =
      token.seller_name ?? `TikTok-${externalAccountId.slice(0, 8)}`;

    const { error } = await supabase
      .from('accounts') // createServiceRoleClient 默认 schema=ads
      .upsert(
        {
          platform: 'tiktok',
          market: (token.seller_base_region?.toLowerCase() ?? 'th') as string,
          external_account_id: externalAccountId,
          account_name: accountName,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_expires_at: new Date(
            token.access_token_expire_in * 1000
          ).toISOString(),
          currency: 'THB', // 占位,后续根据 market 修正
          is_active: true,
        },
        { onConflict: 'platform,external_account_id' }
      );

    if (error) {
      console.error('[TikTok Callback] 写库失败', error);
      return resultUrl('error', `写入数据库失败: ${error.message}`);
    }

    return resultUrl('success', `店铺 ${accountName} 授权成功`);
  } catch (error) {
    console.error('[TikTok Callback Error]', error);
    return resultUrl('error', String(error));
  }
}

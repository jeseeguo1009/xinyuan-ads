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

// market → 默认币种/时区映射
const MARKET_DEFAULTS: Record<
  string,
  { currency: string; timezone: string }
> = {
  TH: { currency: 'THB', timezone: 'Asia/Bangkok' },
  VN: { currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' },
  PH: { currency: 'PHP', timezone: 'Asia/Manila' },
  MY: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
  ID: { currency: 'IDR', timezone: 'Asia/Jakarta' },
  SG: { currency: 'SGD', timezone: 'Asia/Singapore' },
};

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const resultUrl = (status: 'success' | 'error', message: string) =>
    NextResponse.redirect(
      `${origin}/auth/result?status=${status}&message=${encodeURIComponent(message)}`
    );

  try {
    if (!code) return resultUrl('error', '缺少授权码(code)');
    if (!state) return resultUrl('error', '缺少 state 参数');

    // 校验 state 防 CSRF
    // TODO(Phase 2.5 Auth): 恢复严格校验,当前 Netlify 函数间 cookie 不稳定,先放宽
    const cookieStore = await cookies();
    const savedState = cookieStore.get('tiktok_oauth_state')?.value;
    if (savedState && savedState !== state) {
      // cookie 存在但不匹配 → 真的可能是 CSRF
      return resultUrl('error', 'state 校验失败,可能是 CSRF 攻击或会话已过期');
    }
    if (!savedState) {
      // cookie 丢失(Netlify 部署切换导致) → 允许通过,记日志
      console.warn('[TikTok Callback] state cookie 丢失,跳过校验(Netlify 兼容)');
    }
    try { cookieStore.delete('tiktok_oauth_state'); } catch { /* 忽略 */ }

    // 用 auth_code 换 token
    const token = await exchangeCodeForToken(code);

    // 解析 market:TikTok 返回的 seller_base_region 是大写的 ISO 代码(TH/VN/...)
    // 若未返回或不在支持列表,默认 TH
    const rawMarket = (token.seller_base_region ?? 'TH').toUpperCase();
    const market = MARKET_DEFAULTS[rawMarket] ? rawMarket : 'TH';
    const defaults = MARKET_DEFAULTS[market]!;

    const externalAccountId = token.open_id;
    const accountName =
      token.seller_name ?? `TikTok-${externalAccountId.slice(0, 8)}`;

    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .schema('ads')
      .from('accounts')
      .upsert(
        {
          platform: 'tiktok_shop', // 匹配 ads.platform enum
          market,
          external_account_id: externalAccountId,
          account_name: accountName,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_expires_at: new Date(
            token.access_token_expire_in * 1000
          ).toISOString(),
          currency: defaults.currency,
          timezone: defaults.timezone,
          is_active: true,
        },
        { onConflict: 'platform,external_account_id' }
      );

    if (error) {
      console.error('[TikTok Callback] 写库失败', error);
      return resultUrl('error', `写入数据库失败: ${error.message}`);
    }

    return resultUrl('success', `店铺 ${accountName}(${market})授权成功`);
  } catch (error) {
    console.error('[TikTok Callback Error]', error);
    return resultUrl('error', String(error));
  }
}

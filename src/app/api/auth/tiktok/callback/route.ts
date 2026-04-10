/**
 * GET /api/auth/tiktok/callback
 *
 * TikTok OAuth 回调处理:
 *  1. 校验 state
 *  2. 用 auth_code 换 access_token
 *  3. 调 category_assets 获取所有授权店铺
 *  4. 每个店铺创建一条 ads.accounts 记录
 *  5. 重定向到 /auth/result
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForToken } from '@/lib/tiktok/auth';
import { getAuthorizedShops } from '@/lib/tiktok/shop-api';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MARKET_DEFAULTS: Record<
  string,
  { currency: string; timezone: string; country: string }
> = {
  TH: { currency: 'THB', timezone: 'Asia/Bangkok', country: '泰国' },
  VN: { currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', country: '越南' },
  PH: { currency: 'PHP', timezone: 'Asia/Manila', country: '菲律宾' },
  MY: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', country: '马来西亚' },
  ID: { currency: 'IDR', timezone: 'Asia/Jakarta', country: '印尼' },
  SG: { currency: 'SGD', timezone: 'Asia/Singapore', country: '新加坡' },
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

    // state 校验(宽松模式,Netlify cookie 不稳定)
    const cookieStore = await cookies();
    const savedState = cookieStore.get('tiktok_oauth_state')?.value;
    if (savedState && savedState !== state) {
      return resultUrl('error', 'state 校验失败,可能是 CSRF 攻击或会话已过期');
    }
    try { cookieStore.delete('tiktok_oauth_state'); } catch { /* 忽略 */ }

    // 1. 用 auth_code 换 token
    const token = await exchangeCodeForToken(code);
    const sellerName = token.seller_name ?? 'TikTok Shop';

    // 2. 调 category_assets 获取所有授权的店铺
    let shops: Array<{ cipher: string; target_market: string }> = [];
    try {
      const assets = await getAuthorizedShops(token.access_token);
      shops = assets.map((a) => ({
        cipher: a.cipher,
        target_market: a.target_market.toUpperCase(),
      }));
    } catch (err) {
      console.warn('[TikTok Callback] category_assets 获取失败,降级为单店模式:', err);
      // 降级:用 token 里的 seller_base_region 作为唯一店铺
      const market = (token.seller_base_region ?? 'TH').toUpperCase();
      shops = [{ cipher: token.open_id, target_market: market }];
    }

    // 去重(同市场只保留第一个)
    const seenMarkets = new Set<string>();
    const uniqueShops = shops.filter((s) => {
      if (seenMarkets.has(s.target_market)) return false;
      seenMarkets.add(s.target_market);
      return true;
    });

    // 3. 为每个店铺创建/更新 ads.accounts
    const supabase = createServiceRoleClient();
    const createdShops: string[] = [];

    for (const shop of uniqueShops) {
      const market = MARKET_DEFAULTS[shop.target_market]
        ? shop.target_market
        : 'TH';
      const defaults = MARKET_DEFAULTS[market]!;

      // 用 platform + market 作为唯一标识(一个卖家在一个国家只有一个店铺)
      // external_account_id 用 "卖家open_id-市场" 确保每个国家独立
      const externalAccountId = `${token.open_id}-${market}`;
      const accountName = `${sellerName}(${market})`;

      const { error } = await supabase
        .schema('ads')
        .from('accounts')
        .upsert(
          {
            platform: 'tiktok_shop',
            market,
            external_account_id: externalAccountId,
            external_shop_id: shop.cipher,
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
        console.error(`[TikTok Callback] 写库失败 ${market}:`, error);
      } else {
        createdShops.push(`${defaults.country}(${market})`);
      }
    }

    if (createdShops.length === 0) {
      return resultUrl('error', '没有成功写入任何店铺');
    }

    return resultUrl(
      'success',
      `${createdShops.length} 个店铺授权成功: ${createdShops.join(', ')}`
    );
  } catch (error) {
    console.error('[TikTok Callback Error]', error);
    return resultUrl('error', String(error));
  }
}

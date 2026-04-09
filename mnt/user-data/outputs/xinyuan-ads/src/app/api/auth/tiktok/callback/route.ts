/**
 * GET /api/auth/tiktok/callback
 *
 * 作用:接收 TikTok 授权后回调的 auth_code,换成 access_token,存入数据库
 *
 * TikTok 回调格式:
 *   https://xinyuan-ads.netlify.app/api/auth/tiktok/callback?code=xxx&state=xxx
 *
 * 或错误:
 *   ?error=access_denied&error_description=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForToken } from '@/lib/tiktok/auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // 1. 处理用户拒绝授权的情况
  if (error) {
    const description = searchParams.get('error_description') ?? '未知错误';
    return redirectToResult('error', `授权被拒绝: ${description}`);
  }

  if (!code) {
    return redirectToResult('error', '回调缺少 code 参数');
  }

  // 2. 校验 state(防 CSRF)
  const cookieStore = await cookies();
  const savedState = cookieStore.get('tiktok_oauth_state')?.value;

  if (!savedState || savedState !== state) {
    return redirectToResult('error', 'state 校验失败,可能是 CSRF 攻击');
  }

  // 清理 state cookie
  cookieStore.delete('tiktok_oauth_state');

  try {
    // 3. 用 code 换 token
    const tokenData = await exchangeCodeForToken(code);

    // 4. 存入 Supabase(使用 Service Role 绕过 RLS)
    const supabase = createServiceRoleClient();

    // TikTok 返回的时间戳是秒级 Unix,转成 ISO 字符串
    const expiresAt = new Date(tokenData.access_token_expire_in * 1000).toISOString();

    // upsert:如果是同一个 open_id 就更新,否则插入
    const { error: dbError } = await supabase
      .from('accounts')
      .upsert(
        {
          platform: 'tiktok_shop',
          // ⚠️ 注意:这里 market 先用默认值,实际应根据 seller_base_region 映射
          // 或者在 UI 里让用户选择所属市场
          market: mapRegionToMarket(tokenData.seller_base_region),
          external_account_id: tokenData.open_id,
          account_name: tokenData.seller_name ?? `TikTok-${tokenData.open_id.slice(0, 8)}`,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          currency: getCurrencyByRegion(tokenData.seller_base_region),
          is_active: true,
        },
        {
          onConflict: 'platform,external_account_id',
        }
      );

    if (dbError) {
      console.error('[DB Upsert Error]', dbError);
      return redirectToResult('error', `数据库写入失败: ${dbError.message}`);
    }

    // 5. 成功,跳转到结果页
    return redirectToResult('success', `店铺 ${tokenData.seller_name ?? ''} 授权成功`);
  } catch (err) {
    console.error('[TikTok Callback Error]', err);
    return redirectToResult('error', `授权失败: ${String(err)}`);
  }
}

/**
 * 跳转到结果展示页
 */
function redirectToResult(status: 'success' | 'error', message: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = new URL('/auth/result', appUrl);
  url.searchParams.set('status', status);
  url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}

/**
 * TikTok 返回的 region 映射到数据库 enum
 * 具体值需要根据实际返回调整
 */
function mapRegionToMarket(region?: string): string {
  const map: Record<string, string> = {
    TH: 'TH',
    VN: 'VN',
    PH: 'PH',
    MY: 'MY',
    ID: 'ID',
    SG: 'SG',
  };
  return map[region ?? ''] ?? 'VN'; // 默认越南(你刚申请的市场)
}

/**
 * 按市场获取默认币种
 */
function getCurrencyByRegion(region?: string): string {
  const map: Record<string, string> = {
    TH: 'THB',
    VN: 'VND',
    PH: 'PHP',
    MY: 'MYR',
    ID: 'IDR',
    SG: 'SGD',
  };
  return map[region ?? ''] ?? 'VND';
}

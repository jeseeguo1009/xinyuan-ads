/**
 * TikTok Shop Partner Center OAuth 工具函数
 *
 * 官方文档:https://partner.tiktokshop.com/docv2/page/authorization
 *
 * 流程:
 * 1. 构造授权 URL,跳转店主到 TikTok 授权页
 * 2. 店主同意后,TikTok 重定向到 TIKTOK_REDIRECT_URI 并携带 auth_code
 * 3. 用 auth_code 换 access_token 和 refresh_token
 * 4. token 存入 ads.accounts 表
 * 5. access_token 有效期一般 7 天,refresh_token 有效期一般 365 天,需要定时刷新
 */

const TIKTOK_AUTH_BASE = 'https://auth.tiktok-shops.com';
const TIKTOK_API_BASE = 'https://auth.tiktok-shops.com';

export interface TikTokTokenResponse {
  access_token: string;
  access_token_expire_in: number;   // Unix 时间戳(秒)
  refresh_token: string;
  refresh_token_expire_in: number;  // Unix 时间戳(秒)
  open_id: string;
  seller_name?: string;
  seller_base_region?: string;
}

/**
 * 构造授权 URL,让店主去 TikTok 点同意
 *
 * @param state 防 CSRF 的随机字符串,回调时会原样返回
 */
export function buildAuthorizeUrl(state: string): string {
  const appKey = process.env.TIKTOK_APP_KEY;
  if (!appKey) {
    throw new Error('TIKTOK_APP_KEY 未配置');
  }

  const params = new URLSearchParams({
    app_key: appKey,
    state,
  });

  return `${TIKTOK_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

/**
 * 用授权码换 access_token
 *
 * TikTok Shop 的 token 接口格式:
 *   GET https://auth.tiktok-shops.com/api/v2/token/get
 *   ?app_key=xxx&app_secret=xxx&auth_code=xxx&grant_type=authorized_code
 */
export async function exchangeCodeForToken(
  authCode: string
): Promise<TikTokTokenResponse> {
  const appKey = process.env.TIKTOK_APP_KEY || '6jldr5pkh95pf';
  const appSecret = process.env.TIKTOK_APP_SECRET || '94ad91d37fa6a59788c01d938c5afdcd5500f78a';

  const params = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: authCode,
    grant_type: 'authorized_code',
  });

  const url = `${TIKTOK_API_BASE}/api/v2/token/get?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok token 交换失败: ${response.status} ${response.statusText} - ${text}`
    );
  }

  const json = await response.json();

  // TikTok Shop 的响应格式:{ code: 0, message: 'success', data: {...} }
  if (json.code !== 0) {
    throw new Error(
      `TikTok token 交换失败: code=${json.code}, message=${json.message}`
    );
  }

  return json.data as TikTokTokenResponse;
}

/**
 * 刷新 access_token
 * access_token 过期前应主动调用此接口
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TikTokTokenResponse> {
  const appKey = process.env.TIKTOK_APP_KEY || '6jldr5pkh95pf';
  const appSecret = process.env.TIKTOK_APP_SECRET || '94ad91d37fa6a59788c01d938c5afdcd5500f78a';

  const params = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const url = `${TIKTOK_API_BASE}/api/v2/token/refresh?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok token 刷新失败: ${response.status} - ${text}`
    );
  }

  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(
      `TikTok token 刷新失败: code=${json.code}, message=${json.message}`
    );
  }

  return json.data as TikTokTokenResponse;
}

/**
 * 生成随机 state 字符串,用于防 CSRF
 */
export function generateState(): string {
  return crypto.randomUUID();
}

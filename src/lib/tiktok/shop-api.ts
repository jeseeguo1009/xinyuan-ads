/**
 * TikTok Shop Open API 工具
 *
 * 参考: https://partner.tiktokshop.com/docv2
 * 签名: https://partner.tiktokshop.com/docv2/page/sign-your-api-request
 *
 * 关键区别(和 Marketing API 不同):
 *  - Header: x-tts-access-token(不是 Authorization: Bearer）
 *  - 签名在 query 参数里
 *  - API 版本在路径里(如 /authorization/202405/...)
 */

import crypto from 'node:crypto';

const API_BASE = 'https://open-api.tiktokglobalshop.com';

const APP_KEY = process.env.TIKTOK_APP_KEY || '6jldr5pkh95pf';
const APP_SECRET =
  process.env.TIKTOK_APP_SECRET ||
  '94ad91d37fa6a59788c01d938c5afdcd5500f78a';

/**
 * TikTok Shop API 签名算法
 *
 * 1. 取 path(不含 domain 和 query)
 * 2. 把所有 query 参数(除 sign、access_token)按 key 字母排序
 * 3. 拼接: app_secret + path + key1value1key2value2... + body(如有) + app_secret
 * 4. HMAC-SHA256(上面的字符串, app_secret)
 */
export function signRequest(
  path: string,
  queryParams: Record<string, string>,
  body?: string
): string {
  const keys = Object.keys(queryParams)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort();
  const paramStr = keys.map((k) => `${k}${queryParams[k]}`).join('');
  const raw = `${APP_SECRET}${path}${paramStr}${body ?? ''}${APP_SECRET}`;
  return crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
}

/**
 * 调用 TikTok Shop API
 */
export async function callShopApi<T>(
  path: string,
  accessToken: string,
  extraParams: Record<string, string> = {},
  body?: unknown
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const queryParams: Record<string, string> = {
    app_key: APP_KEY,
    timestamp,
    ...extraParams,
  };

  const bodyStr = body ? JSON.stringify(body) : undefined;
  const sign = signRequest(path, queryParams, bodyStr);
  queryParams.sign = sign;

  const qs = new URLSearchParams(queryParams).toString();
  const url = `${API_BASE}${path}?${qs}`;

  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-tts-access-token': accessToken,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikTok Shop API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(
      `TikTok Shop API error: code=${json.code}, message=${json.message}`
    );
  }

  return json.data as T;
}

// ---------- 授权相关接口 ----------

export interface ShopAsset {
  /** 店铺加密 ID,后续 API 调用用这个 */
  cipher: string;
  /** 目标市场:TH/VN/PH/MY/ID/SG */
  target_market: string;
  /** 类别信息 */
  category: { id: number; name: string };
}

/**
 * 获取授权的店铺列表
 * 一个卖家可能授权了多个国家的店铺
 */
export async function getAuthorizedShops(
  accessToken: string
): Promise<ShopAsset[]> {
  const data = await callShopApi<{ category_assets: ShopAsset[] }>(
    '/authorization/202405/category_assets',
    accessToken
  );
  return data.category_assets ?? [];
}

// ---------- 店铺信息接口 ----------

export interface ShopInfo {
  shop_id: string;
  shop_cipher: string;
  shop_name: string;
  region: string;
}

/**
 * 获取店铺详情
 */
export async function getShopInfo(
  accessToken: string,
  shopCipher: string
): Promise<ShopInfo | null> {
  try {
    const data = await callShopApi<ShopInfo>(
      '/shop/202309/shop/get',
      accessToken,
      { shop_cipher: shopCipher }
    );
    return data;
  } catch {
    return null;
  }
}

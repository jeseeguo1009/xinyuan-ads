/**
 * TikTok Shop Marketing API 封装
 *
 * 官方文档:https://partner.tiktokshop.com/docv2/page/marketing-api
 * 签名算法:https://partner.tiktokshop.com/docv2/page/sign
 *
 * 核心概念:
 *  - Campaign(广告活动)→ AdGroup(广告组)→ Ad(创意)三层结构
 *  - 日度指标在 report 接口拉,按日期范围查询
 *  - 所有请求必须带签名(sign),签名 = HMAC-SHA256(排序后的 query + body, app_secret)
 *
 * 使用:
 *   const client = new TikTokMarketingClient(accessToken, shopId);
 *   const campaigns = await client.getCampaigns();
 *
 * 错误处理:
 *  - 401/token 过期 → 调用者负责刷新 token 后重试
 *  - 429 限流 → 指数退避重试(本实现内置 3 次重试)
 *  - 其他 → 抛 TikTokAPIError
 */

import crypto from 'node:crypto';

const API_BASE = 'https://open-api.tiktokglobalshop.com';
const MARKETING_API_VERSION = '202309';

export class TikTokAPIError extends Error {
  constructor(
    message: string,
    public code: number,
    public requestId?: string
  ) {
    super(message);
    this.name = 'TikTokAPIError';
  }
}

// ---------- 数据类型 ----------

export interface TikTokCampaign {
  campaign_id: string;
  campaign_name: string;
  objective_type: string; // PRODUCT_SALES / TRAFFIC / ...
  status: string; // ENABLE / DISABLE / DELETE
  budget?: number;
  budget_mode?: string; // BUDGET_MODE_DAY / BUDGET_MODE_TOTAL
  create_time?: string;
  modify_time?: string;
}

export interface TikTokAdGroup {
  ad_group_id: string;
  campaign_id: string;
  ad_group_name: string;
  status: string;
  bid_price?: number;
  bid_type?: string;
  targeting?: Record<string, unknown>;
}

export interface TikTokAd {
  ad_id: string;
  ad_group_id: string;
  ad_name: string;
  status: string;
  sku_id?: string;
  item_id?: string;
  creative_type?: string;
  video_url?: string;
  image_url?: string;
}

export interface TikTokDailyMetric {
  stat_time_day: string; // YYYY-MM-DD
  ad_id?: string;
  ad_group_id?: string;
  campaign_id?: string;
  impressions: number;
  clicks: number;
  spend: number; // 本币
  orders: number;
  gross_revenue: number; // GMV 本币
  video_play_actions?: number;
  // ... 更多字段
}

// ---------- 签名算法 ----------

/**
 * 计算 TikTok Shop API 签名
 *
 * 算法:
 *  1. 把所有 query 参数(除 sign 和 access_token)按 key 字母排序
 *  2. 拼接成 key1value1key2value2... 字符串
 *  3. 前后加上 path:path + 上面的字符串 + body(JSON 字符串,如果是 POST)
 *  4. 用 app_secret 作为 key 做 HMAC-SHA256
 *  5. 结果转 hex 小写
 */
export function calcSign(
  path: string,
  queryParams: Record<string, string>,
  body: string | undefined,
  appSecret: string
): string {
  // 1. 排序
  const keys = Object.keys(queryParams)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort();

  // 2. 拼 key+value
  const joined = keys.map((k) => `${k}${queryParams[k]}`).join('');

  // 3. 前后加 path 和 body
  let raw = `${appSecret}${path}${joined}`;
  if (body) raw += body;
  raw += appSecret;

  // 4. HMAC-SHA256
  return crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
}

// ---------- 核心客户端 ----------

export class TikTokMarketingClient {
  constructor(
    private readonly accessToken: string,
    private readonly shopId: string,
    private readonly appKey: string = process.env.TIKTOK_APP_KEY ?? '',
    private readonly appSecret: string = process.env.TIKTOK_APP_SECRET ?? ''
  ) {
    if (!this.appKey || !this.appSecret) {
      throw new Error('TIKTOK_APP_KEY / TIKTOK_APP_SECRET 未配置');
    }
  }

  /** 通用请求方法 */
  private async request<T>(
    path: string,
    params: Record<string, string | number> = {},
    body?: unknown
  ): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const queryParams: Record<string, string> = {
      app_key: this.appKey,
      timestamp,
      shop_id: this.shopId,
      version: MARKETING_API_VERSION,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    };

    const bodyStr = body ? JSON.stringify(body) : undefined;
    const sign = calcSign(path, queryParams, bodyStr, this.appSecret);
    queryParams.sign = sign;
    queryParams.access_token = this.accessToken;

    const url = `${API_BASE}${path}?${new URLSearchParams(queryParams).toString()}`;

    // 最多 3 次重试,指数退避
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
        });

        // 限流:退避重试
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          lastErr = new TikTokAPIError('限流', 429);
          continue;
        }

        const json = await res.json();
        if (json.code !== 0) {
          throw new TikTokAPIError(
            json.message ?? '未知错误',
            json.code,
            json.request_id
          );
        }
        return json.data as T;
      } catch (err) {
        lastErr = err;
        if (err instanceof TikTokAPIError && err.code !== 429) {
          throw err; // 非限流错误直接抛
        }
      }
    }
    throw lastErr;
  }

  /** 获取广告活动列表 */
  async getCampaigns(params?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }): Promise<{ campaigns: TikTokCampaign[]; total: number }> {
    const data = await this.request<{
      campaigns: TikTokCampaign[];
      total_count: number;
    }>(`/ad/${MARKETING_API_VERSION}/campaign/get`, {
      page_number: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(params?.status ? { status: params.status } : {}),
    });
    return { campaigns: data.campaigns ?? [], total: data.total_count ?? 0 };
  }

  /** 获取广告组列表 */
  async getAdGroups(params: {
    campaignIds?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ adGroups: TikTokAdGroup[]; total: number }> {
    const data = await this.request<{
      ad_groups: TikTokAdGroup[];
      total_count: number;
    }>(`/ad/${MARKETING_API_VERSION}/adgroup/get`, {
      page_number: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(params.campaignIds
        ? { campaign_ids: JSON.stringify(params.campaignIds) }
        : {}),
    });
    return { adGroups: data.ad_groups ?? [], total: data.total_count ?? 0 };
  }

  /** 获取广告创意列表 */
  async getAds(params: {
    adGroupIds?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ ads: TikTokAd[]; total: number }> {
    const data = await this.request<{
      ads: TikTokAd[];
      total_count: number;
    }>(`/ad/${MARKETING_API_VERSION}/ad/get`, {
      page_number: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(params.adGroupIds
        ? { ad_group_ids: JSON.stringify(params.adGroupIds) }
        : {}),
    });
    return { ads: data.ads ?? [], total: data.total_count ?? 0 };
  }

  /**
   * 获取日度指标
   * @param startDate YYYY-MM-DD
   * @param endDate YYYY-MM-DD
   * @param dimension 'campaign' | 'ad_group' | 'ad'
   */
  async getDailyMetrics(params: {
    startDate: string;
    endDate: string;
    dimension?: 'campaign' | 'ad_group' | 'ad';
    entityIds?: string[];
  }): Promise<TikTokDailyMetric[]> {
    const data = await this.request<{ report: TikTokDailyMetric[] }>(
      `/ad/${MARKETING_API_VERSION}/report/integrated/get`,
      {},
      {
        start_date: params.startDate,
        end_date: params.endDate,
        time_granularity: 'STAT_TIME_DAY',
        dimension: params.dimension ?? 'ad',
        metrics: [
          'impressions',
          'clicks',
          'spend',
          'orders',
          'gross_revenue',
          'video_play_actions',
        ],
        ...(params.entityIds ? { entity_ids: params.entityIds } : {}),
      }
    );
    return data.report ?? [];
  }
}

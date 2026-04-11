/**
 * TikTok Business API (Marketing API) 客户端
 *
 * 官方文档: https://business-api.tiktok.com/portal/docs
 *
 * 和 Shop API 的区别:
 *  - Base URL: business-api.tiktok.com（不是 open-api.tiktokglobalshop.com）
 *  - 认证: Header "Access-Token"（不需要 HMAC 签名）
 *  - 广告数据核心: advertiser_id（不是 shop_id）
 *  - GMV Max / Smart+ 广告也走这套 API
 *
 * 使用:
 *   const client = new TikTokBusinessClient(accessToken, advertiserId);
 *   const campaigns = await client.getCampaigns();
 *   const report = await client.getReport({ ... });
 */

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export class TikTokBusinessError extends Error {
  constructor(
    message: string,
    public code: number,
    public requestId?: string
  ) {
    super(message);
    this.name = 'TikTokBusinessError';
  }
}

// ---------- 数据类型 ----------

export interface BusinessCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string; // REGULAR_CAMPAIGN / SMART_PLUS_CAMPAIGN
  objective_type: string; // PRODUCT_SALES / TRAFFIC / ...
  status: string; // CAMPAIGN_STATUS_ENABLE / DISABLE / DELETE
  budget: number;
  budget_mode: string; // BUDGET_MODE_DAY / BUDGET_MODE_TOTAL / BUDGET_MODE_INFINITE
  create_time: string;
  modify_time: string;
  smart_plus_type?: string; // GMV_MAX_ADS 等
}

export interface BusinessAdGroup {
  adgroup_id: string;
  campaign_id: string;
  adgroup_name: string;
  status: string;
  bid_price?: number;
  bid_type?: string;
  budget: number;
  budget_mode: string;
  optimization_goal?: string;
}

export interface BusinessAd {
  ad_id: string;
  adgroup_id: string;
  ad_name: string;
  status: string;
  ad_format?: string;
  image_ids?: string[];
  video_id?: string;
  landing_page_url?: string;
}

export interface ReportMetric {
  dimensions: {
    stat_time_day?: string;
    campaign_id?: string;
    adgroup_id?: string;
    ad_id?: string;
  };
  metrics: {
    spend: string;
    impressions: string;
    clicks: string;
    conversions: string;
    cost_per_conversion: string;
    conversion_rate: string;
    ctr: string;
    cpc: string;
    cpm: string;
    // GMV Max / Shop 相关
    total_complete_payment_rate?: string;
    complete_payment?: string; // 订单数
    total_onsite_shopping_value?: string; // GMV
    onsite_shopping?: string;
    // 更多指标按需添加
    [key: string]: string | undefined;
  };
}

// ---------- 核心客户端 ----------

export class TikTokBusinessClient {
  constructor(
    private readonly accessToken: string,
    private readonly advertiserId: string
  ) {
    if (!this.accessToken) {
      throw new Error('TikTok Business API access_token 未配置');
    }
    if (!this.advertiserId) {
      throw new Error('TikTok Business API advertiser_id 未配置');
    }
  }

  /** 通用 GET 请求 */
  private async get<T>(
    path: string,
    params: Record<string, string | number | string[]> = {}
  ): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);

    // 添加 advertiser_id
    url.searchParams.set('advertiser_id', this.advertiserId);

    // 添加其他参数
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return this.doRequest<T>(url.toString(), 'GET');
  }

  /** 通用 POST 请求（报表等接口用 POST） */
  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${API_BASE}${path}`;
    return this.doRequest<T>(url, 'POST', {
      advertiser_id: this.advertiserId,
      ...body,
    });
  }

  /** 发起请求,含重试 */
  private async doRequest<T>(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<T> {
    let lastErr: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Access-Token': this.accessToken,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        // 限流重试
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          lastErr = new TikTokBusinessError('限流', 429);
          continue;
        }

        const json = await res.json();

        if (json.code !== 0) {
          throw new TikTokBusinessError(
            json.message ?? '未知错误',
            json.code,
            json.request_id
          );
        }

        return json.data as T;
      } catch (err) {
        lastErr = err;
        if (err instanceof TikTokBusinessError && err.code !== 429) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  // ---------- Campaign 接口 ----------

  /** 获取广告活动列表 */
  async getCampaigns(params?: {
    page?: number;
    pageSize?: number;
    filtering?: Record<string, unknown>;
  }): Promise<{ campaigns: BusinessCampaign[]; total: number; page: number }> {
    const data = await this.get<{
      list: BusinessCampaign[];
      page_info: { total_number: number; page: number; page_size: number; total_page: number };
    }>('/campaign/get/', {
      page: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(params?.filtering ? { filtering: JSON.stringify(params.filtering) } : {}),
    });

    return {
      campaigns: data.list ?? [],
      total: data.page_info?.total_number ?? 0,
      page: data.page_info?.page ?? 1,
    };
  }

  /** 获取广告组列表 */
  async getAdGroups(params: {
    campaignIds?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ adGroups: BusinessAdGroup[]; total: number }> {
    const filtering: Record<string, unknown> = {};
    if (params.campaignIds?.length) {
      filtering.campaign_ids = params.campaignIds;
    }

    const data = await this.get<{
      list: BusinessAdGroup[];
      page_info: { total_number: number };
    }>('/adgroup/get/', {
      page: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(Object.keys(filtering).length ? { filtering: JSON.stringify(filtering) } : {}),
    });

    return {
      adGroups: data.list ?? [],
      total: data.page_info?.total_number ?? 0,
    };
  }

  /** 获取广告列表 */
  async getAds(params: {
    adGroupIds?: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ ads: BusinessAd[]; total: number }> {
    const filtering: Record<string, unknown> = {};
    if (params.adGroupIds?.length) {
      filtering.adgroup_ids = params.adGroupIds;
    }

    const data = await this.get<{
      list: BusinessAd[];
      page_info: { total_number: number };
    }>('/ad/get/', {
      page: params?.page ?? 1,
      page_size: params?.pageSize ?? 100,
      ...(Object.keys(filtering).length ? { filtering: JSON.stringify(filtering) } : {}),
    });

    return {
      ads: data.list ?? [],
      total: data.page_info?.total_number ?? 0,
    };
  }

  // ---------- Report 接口 ----------

  /**
   * 获取综合报表（日度指标）
   *
   * Business API 报表接口用 POST,和 Shop API 很不一样
   *
   * @param startDate YYYY-MM-DD
   * @param endDate YYYY-MM-DD
   * @param dimension AUCTION_CAMPAIGN / AUCTION_ADGROUP / AUCTION_AD
   */
  async getReport(params: {
    startDate: string;
    endDate: string;
    dimension?: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
    metrics?: string[];
    filtering?: Record<string, unknown>;
    page?: number;
    pageSize?: number;
  }): Promise<{ rows: ReportMetric[]; total: number }> {
    // 默认指标集:广告核心指标 + 电商指标
    const metrics = params.metrics ?? [
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'conversions',
      'cost_per_conversion',
      'conversion_rate',
      'complete_payment',
      'total_onsite_shopping_value',
    ];

    const data = await this.post<{
      list: ReportMetric[];
      page_info: { total_number: number; page: number; page_size: number; total_page: number };
    }>('/report/integrated/get/', {
      report_type: 'BASIC',
      dimensions: ['stat_time_day', params.dimension === 'AUCTION_CAMPAIGN' ? 'campaign_id' : params.dimension === 'AUCTION_ADGROUP' ? 'adgroup_id' : 'ad_id'],
      data_level: params.dimension ?? 'AUCTION_AD',
      start_date: params.startDate,
      end_date: params.endDate,
      metrics,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 200,
      ...(params.filtering ? { filtering: params.filtering } : {}),
    });

    return {
      rows: data.list ?? [],
      total: data.page_info?.total_number ?? 0,
    };
  }

  // ---------- OAuth 工具方法（静态） ----------

  /**
   * 构造 Business API 授权 URL
   */
  static buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      app_id: appId,
      state,
      redirect_uri: redirectUri,
    });
    return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
  }

  /**
   * 用授权码换 access_token
   *
   * 返回:
   *  - access_token（长期有效,不会过期,除非用户主动撤销）
   *  - advertiser_ids（该 token 可访问的所有广告主 ID 列表）
   */
  static async exchangeCodeForToken(
    appId: string,
    secret: string,
    authCode: string
  ): Promise<{
    access_token: string;
    advertiser_ids: string[];
  }> {
    const url = `${API_BASE}/oauth2/access_token/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        secret,
        auth_code: authCode,
      }),
    });

    const json = await res.json();
    if (json.code !== 0) {
      throw new TikTokBusinessError(
        json.message ?? 'Token 交换失败',
        json.code,
        json.request_id
      );
    }

    return {
      access_token: json.data.access_token,
      advertiser_ids: json.data.advertiser_ids ?? [],
    };
  }
}

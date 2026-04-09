-- =====================================================================
-- 欣远电商广告数据 Agent - 数据库 Schema 设计
-- =====================================================================
-- 版本: v1.0
-- 创建日期: 2026-04-08
-- 说明: 跨境电商多平台广告数据统一存储方案
--       支持 TikTok Shop Ads 和 Shopee Ads,覆盖东南亚六国
-- =====================================================================

-- 创建独立 schema,和商品管理系统(public schema)隔离
CREATE SCHEMA IF NOT EXISTS ads;

-- 设置搜索路径
SET search_path TO ads, public;


-- =====================================================================
-- 1. 枚举类型定义
-- =====================================================================

-- 广告平台
CREATE TYPE ads.platform AS ENUM (
  'tiktok_shop',
  'shopee',
  'lazada'  -- 预留,未来可能扩展
);

-- 目标市场(东南亚六国 + 预留)
CREATE TYPE ads.market AS ENUM (
  'TH',  -- 泰国
  'VN',  -- 越南
  'PH',  -- 菲律宾
  'MY',  -- 马来西亚
  'ID',  -- 印度尼西亚
  'SG'   -- 新加坡
);

-- 广告活动状态
CREATE TYPE ads.campaign_status AS ENUM (
  'enabled',      -- 运行中
  'paused',       -- 已暂停
  'deleted',      -- 已删除
  'pending',      -- 审核中
  'rejected'      -- 审核拒绝
);

-- 广告目标类型
CREATE TYPE ads.campaign_objective AS ENUM (
  'product_sales',      -- 商品销量
  'traffic',            -- 引流
  'video_views',        -- 视频播放
  'followers',          -- 涨粉
  'live_room_promotion' -- 直播间推广
);

-- 同步任务状态
CREATE TYPE ads.sync_status AS ENUM (
  'pending',
  'running',
  'success',
  'failed',
  'partial'  -- 部分成功
);


-- =====================================================================
-- 2. 广告账户表(platforms × shops)
-- =====================================================================
-- 一个账户 = 某个平台的某个店铺的广告账户
-- 例如:TikTok Shop 越南店 的广告账户

CREATE TABLE ads.accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          ads.platform NOT NULL,
  market            ads.market NOT NULL,

  -- 平台侧标识
  external_account_id TEXT NOT NULL,          -- 平台返回的账户 ID
  external_shop_id    TEXT,                   -- 店铺 ID(TikTok Shop 专用)
  account_name        TEXT NOT NULL,          -- 账户显示名,如 "欣远-越南-TikTok"

  -- 授权凭证(加密存储,建议用 Supabase Vault)
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,

  -- 币种和时区
  currency            CHAR(3) NOT NULL,       -- THB/VND/PHP/MYR/IDR/SGD
  timezone            TEXT NOT NULL DEFAULT 'Asia/Bangkok',

  -- 运营信息
  operator_code       TEXT,                   -- 负责该店铺的运营代码(和 SKU 命名系统呼应)
  is_active           BOOLEAN NOT NULL DEFAULT true,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (platform, external_account_id)
);

CREATE INDEX idx_accounts_platform_market ON ads.accounts (platform, market);
CREATE INDEX idx_accounts_active ON ads.accounts (is_active) WHERE is_active = true;

COMMENT ON TABLE ads.accounts IS '广告账户:每个店铺在每个平台的广告账户';
COMMENT ON COLUMN ads.accounts.operator_code IS '对应 SKU 命名系统中的运营代码,便于归因';


-- =====================================================================
-- 3. 广告活动(Campaign)
-- =====================================================================
-- Campaign 是广告结构的最顶层,一个 Campaign 下有多个 Ad Group

CREATE TABLE ads.campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES ads.accounts(id) ON DELETE CASCADE,

  external_campaign_id  TEXT NOT NULL,        -- 平台侧 Campaign ID
  campaign_name         TEXT NOT NULL,
  objective             ads.campaign_objective,
  status                ads.campaign_status NOT NULL DEFAULT 'enabled',

  -- 预算(以账户币种计)
  budget                NUMERIC(14, 4),       -- 日预算或总预算
  budget_type           TEXT,                 -- 'daily' | 'total'

  start_time            TIMESTAMPTZ,
  end_time              TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ,          -- 上次从平台同步的时间

  UNIQUE (account_id, external_campaign_id)
);

CREATE INDEX idx_campaigns_account ON ads.campaigns (account_id);
CREATE INDEX idx_campaigns_status ON ads.campaigns (status);


-- =====================================================================
-- 4. 广告组(Ad Group)
-- =====================================================================

CREATE TABLE ads.ad_groups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES ads.campaigns(id) ON DELETE CASCADE,

  external_ad_group_id  TEXT NOT NULL,
  ad_group_name         TEXT NOT NULL,
  status                ads.campaign_status NOT NULL DEFAULT 'enabled',

  -- 定向(存 JSON,各平台结构差异大)
  targeting             JSONB,                -- {age, gender, location, interests, ...}

  -- 出价信息
  bid_amount            NUMERIC(14, 4),
  bid_type              TEXT,                 -- 'cpc' | 'cpm' | 'target_roas' | ...

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ,

  UNIQUE (campaign_id, external_ad_group_id)
);

CREATE INDEX idx_ad_groups_campaign ON ads.ad_groups (campaign_id);


-- =====================================================================
-- 5. 广告创意(Ad)
-- =====================================================================

CREATE TABLE ads.ads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id           UUID NOT NULL REFERENCES ads.ad_groups(id) ON DELETE CASCADE,

  external_ad_id        TEXT NOT NULL,
  ad_name               TEXT NOT NULL,
  status                ads.campaign_status NOT NULL DEFAULT 'enabled',

  -- 关联的商品(关键:打通广告和商品管理系统)
  -- 通过 SKU/货号 关联到 public schema 的商品表
  sku_code              TEXT,                 -- 如 'WS-HH-PS-03-25001-BK-38'
  product_id            UUID,                 -- 预留,关联 public.products(id)

  -- 创意内容
  creative_type         TEXT,                 -- 'video' | 'image' | 'carousel'
  creative_url          TEXT,                 -- 视频/图片 URL

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ,

  UNIQUE (ad_group_id, external_ad_id)
);

CREATE INDEX idx_ads_ad_group ON ads.ads (ad_group_id);
CREATE INDEX idx_ads_sku ON ads.ads (sku_code) WHERE sku_code IS NOT NULL;


-- =====================================================================
-- 6. 日度指标(核心表,最高频访问)
-- =====================================================================
-- 每个广告每天一行,这是所有分析的基础

CREATE TABLE ads.daily_metrics (
  id                    BIGSERIAL PRIMARY KEY,

  -- 维度
  account_id            UUID NOT NULL REFERENCES ads.accounts(id) ON DELETE CASCADE,
  campaign_id           UUID REFERENCES ads.campaigns(id) ON DELETE CASCADE,
  ad_group_id           UUID REFERENCES ads.ad_groups(id) ON DELETE CASCADE,
  ad_id                 UUID REFERENCES ads.ads(id) ON DELETE CASCADE,

  stat_date             DATE NOT NULL,        -- 统计日期(按账户所在时区)

  -- === 基础指标 ===
  impressions           BIGINT NOT NULL DEFAULT 0,  -- 曝光
  clicks                BIGINT NOT NULL DEFAULT 0,  -- 点击

  -- === 花费(双币种存储)===
  spend_local           NUMERIC(14, 4) NOT NULL DEFAULT 0,   -- 本币花费(THB/VND/...)
  spend_cny             NUMERIC(14, 4) NOT NULL DEFAULT 0,   -- 人民币花费(按当日汇率)
  exchange_rate         NUMERIC(14, 6),                      -- 使用的汇率,便于追溯

  -- === 转化指标 ===
  orders                INTEGER NOT NULL DEFAULT 0,          -- 订单数
  units_sold            INTEGER NOT NULL DEFAULT 0,          -- 销量(件数)
  gmv_local             NUMERIC(14, 4) NOT NULL DEFAULT 0,   -- GMV 本币
  gmv_cny               NUMERIC(14, 4) NOT NULL DEFAULT 0,   -- GMV 人民币

  -- === 视频指标(TikTok 特有)===
  video_views           BIGINT DEFAULT 0,
  video_views_2s        BIGINT DEFAULT 0,
  video_views_6s        BIGINT DEFAULT 0,
  video_views_completed BIGINT DEFAULT 0,

  -- === 直播指标(预留)===
  live_views            BIGINT DEFAULT 0,
  live_viewers_peak     INTEGER DEFAULT 0,

  -- === 衍生指标(存储而非实时计算,加快查询)===
  ctr                   NUMERIC(8, 6),        -- 点击率 = clicks / impressions
  cpc_cny               NUMERIC(14, 4),       -- 每次点击成本 = spend_cny / clicks
  cpm_cny               NUMERIC(14, 4),       -- 千次曝光成本
  cvr                   NUMERIC(8, 6),        -- 转化率 = orders / clicks
  roi                   NUMERIC(10, 4),       -- ROI = gmv_cny / spend_cny
  cpa_cny               NUMERIC(14, 4),       -- 每单成本 = spend_cny / orders

  -- 数据来源和同步信息
  data_source           TEXT NOT NULL DEFAULT 'api',  -- 'api' | 'erp' | 'manual'
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同一个广告在同一天只能有一行
  UNIQUE (ad_id, stat_date)
);

-- 核心索引(按查询频率设计)
CREATE INDEX idx_daily_metrics_date ON ads.daily_metrics (stat_date DESC);
CREATE INDEX idx_daily_metrics_account_date ON ads.daily_metrics (account_id, stat_date DESC);
CREATE INDEX idx_daily_metrics_campaign_date ON ads.daily_metrics (campaign_id, stat_date DESC);
CREATE INDEX idx_daily_metrics_ad_date ON ads.daily_metrics (ad_id, stat_date DESC);

-- 分区建议(数据量大了之后):按月分区
-- 一个店铺每天几百条数据,一年下来 6 个店铺 × 365 天 × 500 条 ≈ 100 万行
-- 现阶段不需要分区,超过 1000 万行再考虑


-- =====================================================================
-- 7. 汇率表
-- =====================================================================
-- 每天记录一次汇率,用于花费和 GMV 的人民币换算

CREATE TABLE ads.exchange_rates (
  id            BIGSERIAL PRIMARY KEY,
  currency      CHAR(3) NOT NULL,
  rate_to_cny   NUMERIC(14, 6) NOT NULL,  -- 1 单位外币 = N 人民币
  rate_date     DATE NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',  -- 汇率来源,如 'boc'(中行)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (currency, rate_date)
);

CREATE INDEX idx_exchange_rates_date ON ads.exchange_rates (rate_date DESC);


-- =====================================================================
-- 8. 同步任务日志
-- =====================================================================
-- 记录每次从平台拉取数据的任务状态,便于排查问题

CREATE TABLE ads.sync_logs (
  id                BIGSERIAL PRIMARY KEY,
  account_id        UUID REFERENCES ads.accounts(id) ON DELETE CASCADE,
  sync_type         TEXT NOT NULL,        -- 'campaigns' | 'ad_groups' | 'ads' | 'metrics'
  status            ads.sync_status NOT NULL DEFAULT 'pending',

  target_date       DATE,                 -- 同步的数据日期
  records_fetched   INTEGER DEFAULT 0,
  records_upserted  INTEGER DEFAULT 0,

  error_message     TEXT,
  error_stack       TEXT,

  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  duration_ms       INTEGER
);

CREATE INDEX idx_sync_logs_account_status ON ads.sync_logs (account_id, status, started_at DESC);
CREATE INDEX idx_sync_logs_started ON ads.sync_logs (started_at DESC);


-- =====================================================================
-- 9. 自动更新 updated_at 触发器
-- =====================================================================

CREATE OR REPLACE FUNCTION ads.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON ads.accounts
  FOR EACH ROW EXECUTE FUNCTION ads.set_updated_at();

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON ads.campaigns
  FOR EACH ROW EXECUTE FUNCTION ads.set_updated_at();

CREATE TRIGGER trg_ad_groups_updated_at
  BEFORE UPDATE ON ads.ad_groups
  FOR EACH ROW EXECUTE FUNCTION ads.set_updated_at();

CREATE TRIGGER trg_ads_updated_at
  BEFORE UPDATE ON ads.ads
  FOR EACH ROW EXECUTE FUNCTION ads.set_updated_at();


-- =====================================================================
-- 10. 常用视图:按天汇总到账户级别
-- =====================================================================

CREATE OR REPLACE VIEW ads.v_account_daily AS
SELECT
  a.id                AS account_id,
  a.account_name,
  a.platform,
  a.market,
  a.currency,
  a.operator_code,
  m.stat_date,
  SUM(m.impressions)  AS impressions,
  SUM(m.clicks)       AS clicks,
  SUM(m.spend_local)  AS spend_local,
  SUM(m.spend_cny)    AS spend_cny,
  SUM(m.orders)       AS orders,
  SUM(m.units_sold)   AS units_sold,
  SUM(m.gmv_local)    AS gmv_local,
  SUM(m.gmv_cny)      AS gmv_cny,
  -- 汇总级别的衍生指标
  CASE WHEN SUM(m.impressions) > 0
    THEN SUM(m.clicks)::NUMERIC / SUM(m.impressions)
    ELSE 0 END        AS ctr,
  CASE WHEN SUM(m.spend_cny) > 0
    THEN SUM(m.gmv_cny) / SUM(m.spend_cny)
    ELSE 0 END        AS roi
FROM ads.accounts a
LEFT JOIN ads.daily_metrics m ON m.account_id = a.id
GROUP BY a.id, a.account_name, a.platform, a.market, a.currency, a.operator_code, m.stat_date;

COMMENT ON VIEW ads.v_account_daily IS '账户级日度汇总,用于看板首页';


-- =====================================================================
-- 11. Row Level Security(权限控制)
-- =====================================================================
-- 启用 RLS,具体策略后续根据角色设计(L1-L5 运营、管理层、财务等)

ALTER TABLE ads.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.ad_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.sync_logs ENABLE ROW LEVEL SECURITY;

-- 临时策略:认证用户可读,后续细化
CREATE POLICY "authenticated_read_accounts"
  ON ads.accounts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_campaigns"
  ON ads.campaigns FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_ad_groups"
  ON ads.ad_groups FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_ads"
  ON ads.ads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_metrics"
  ON ads.daily_metrics FOR SELECT
  TO authenticated USING (true);


-- =====================================================================
-- 完成
-- =====================================================================
-- 下一步:
--   1. 在 Supabase SQL Editor 执行此脚本
--   2. 手动插入第一条测试账户数据
--   3. 开发数据拉取 Edge Function
-- =====================================================================

-- =====================================================================
-- 9. 权限授予(PostgREST / Supabase Data API 必需)
-- 说明:创建 schema 后,三个角色(anon/authenticated/service_role)
--      默认没有 USAGE 权限,必须显式 GRANT,否则 API 报
--      "permission denied for schema ads"
-- =====================================================================

GRANT USAGE ON SCHEMA ads TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ads
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ads
  TO anon, authenticated, service_role;

-- 未来新建的表/序列也自动授权
ALTER DEFAULT PRIVILEGES IN SCHEMA ads
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA ads
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role;

-- 通知 PostgREST 重新加载配置(使 GRANT 立即生效)
NOTIFY pgrst, 'reload config';

-- =====================================================================
-- 使用前检查清单:
--   ✅ Supabase Project Settings → API → Exposed schemas 已添加 `ads`
--   ✅ Exposed tables 已勾选需要的表(默认全 8 张)
--   ✅ 本 SQL 已完整执行一次
-- =====================================================================

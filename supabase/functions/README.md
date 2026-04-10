# Supabase Edge Functions

这里存放 Phase 3+ 的定时任务和重活 Edge Functions。

## 已有 Functions

### `fetch-exchange-rates`
每天早上 6:00(北京)拉取 THB/VND/PHP/MYR/IDR/SGD 对 CNY 的汇率,写入 `ads.exchange_rates`。

**依赖环境变量**(在 Supabase Dashboard → Project Settings → Edge Functions → Secrets 设置):
- `SUPABASE_URL`(自动注入)
- `SUPABASE_SERVICE_ROLE_KEY`(自动注入)
- `EXCHANGE_RATE_API_KEY`(可选,未配置时降级到 open.er-api.com 无需 key 源)

### `generate-daily-report`
每天早上 8:30(北京)生成运营日报并推飞书。

**依赖环境变量**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`(未配置时走 mock 文本)
- `FEISHU_WEBHOOK_URL`(未配置时不推送,只返回日报)

---

## 首次部署步骤

### 1. 登录 Supabase CLI

```bash
supabase login
```

浏览器会打开授权页。

### 2. 关联本地项目到远端

```bash
cd ~/xinyuan-ads
supabase link --project-ref dfvmmoptijmqhymukrlz
```

`dfvmmoptijmqhymukrlz` 是 `NEXT_PUBLIC_SUPABASE_URL` 里的 project ref。

### 3. 设置 Edge Function Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
supabase secrets set FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx
supabase secrets set EXCHANGE_RATE_API_KEY=xxxxxxxx   # 可选
```

### 4. 部署

```bash
supabase functions deploy fetch-exchange-rates
supabase functions deploy generate-daily-report
```

### 5. 配置定时触发(pg_cron)

在 Supabase Dashboard → Database → Extensions 启用 `pg_cron` 和 `pg_net`,然后在 SQL Editor 运行:

```sql
-- 每天 22:00 UTC = 06:00 北京时间,拉汇率
SELECT cron.schedule(
  'fetch-exchange-rates-daily',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dfvmmoptijmqhymukrlz.functions.supabase.co/fetch-exchange-rates',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- 每天 00:30 UTC = 08:30 北京时间,发日报
SELECT cron.schedule(
  'generate-daily-report',
  '30 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dfvmmoptijmqhymukrlz.functions.supabase.co/generate-daily-report',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- 查看已注册的定时任务
SELECT * FROM cron.job;

-- 手动触发测试(先把 URL 改成 Invoke URL,或者直接用 supabase functions invoke)
```

### 6. 手动测试

```bash
# 命令行调用
supabase functions invoke fetch-exchange-rates
supabase functions invoke generate-daily-report
```

或用 curl:

```bash
curl -X POST \
  https://dfvmmoptijmqhymukrlz.functions.supabase.co/generate-daily-report \
  -H "Authorization: Bearer <anon_key_or_service_role_key>" \
  -H "Content-Type: application/json"
```

### 7. 查看日志

```bash
supabase functions logs generate-daily-report --tail
```

或 Supabase Dashboard → Edge Functions → 点函数名 → Logs。

---

## 本地开发

```bash
supabase start           # 启动本地 Supabase 栈(需要 Docker)
supabase functions serve # 本地运行 Edge Functions
```

然后在另一个终端调用:
```bash
curl http://localhost:54321/functions/v1/generate-daily-report \
  -H "Authorization: Bearer <local_anon_key>"
```

---

## TODO

- [ ] `daily_reports` 表用于缓存每日报告(避免前端每次刷新都调 Claude)
- [ ] Edge Function 加上签名校验,防止被外部恶意触发
- [ ] 汇率拉取失败时自动重试 3 次
- [ ] 日报失败时推告警到飞书

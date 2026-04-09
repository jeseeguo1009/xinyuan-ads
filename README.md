# xinyuan-ads 欣远广告数据 Agent

跨境电商多平台广告数据统一采集、分析、智能决策系统。

**覆盖平台**:TikTok Shop Ads、Shopee Ads
**覆盖市场**:泰国、越南、菲律宾、马来西亚、印尼、新加坡
**技术栈**:Next.js 15 + Supabase + Netlify + Claude API

---

## 一、项目初始化步骤

### 1. 创建 Next.js 项目

```bash
# 到你的工作目录
cd ~/code

# 创建项目(一路按回车选默认,除了下面几项)
npx create-next-app@latest xinyuan-ads

# 选项建议:
# ✔ Would you like to use TypeScript? … Yes
# ✔ Would you like to use ESLint? … Yes
# ✔ Would you like to use Tailwind CSS? … Yes
# ✔ Would you like your code inside a `src/` directory? … Yes
# ✔ Would you like to use App Router? … Yes (重要)
# ✔ Would you like to use Turbopack? … Yes
# ✔ Would you like to customize the import alias? … No

cd xinyuan-ads
```

### 2. 安装必要依赖

```bash
# Supabase
npm install @supabase/supabase-js @supabase/ssr

# shadcn/ui(你之前项目用的)
npx shadcn@latest init

# Claude SDK(Agent 层用)
npm install @anthropic-ai/sdk

# 日期处理
npm install date-fns
```

### 3. 初始化 Git 和 GitHub

```bash
git init
git add .
git commit -m "初始化项目"

# 在 GitHub 创建一个名为 xinyuan-ads 的空仓库,然后:
git remote add origin git@github.com:你的用户名/xinyuan-ads.git
git branch -M main
git push -u origin main
```

### 4. 连接 Netlify

**方式 A:通过网页连接(推荐)**

1. 登录 https://app.netlify.com
2. 点击 **Add new site** → **Import an existing project**
3. 选择 GitHub,授权后选择 `xinyuan-ads` 仓库
4. 构建配置 Netlify 会自动识别 Next.js,保持默认即可:
   - Build command: `next build`
   - Publish directory: `.next`
5. 点击 **Deploy site**
6. 部署完成后,在 **Site settings → Site details → Change site name** 改成 `xinyuan-ads`
7. 你的域名就是:`https://xinyuan-ads.netlify.app`

**方式 B:通过命令行**

```bash
npm install -g netlify-cli
netlify login
netlify init
# 按提示:Create & configure a new project
# Team 选你自己
# Site name 填 xinyuan-ads
```

### 5. 配置环境变量

把项目根目录的 `.env.example` 复制成 `.env.local`,填入真实值用于本地开发。

**Netlify 生产环境**:
1. 进入 Netlify 站点 → **Site settings** → **Environment variables**
2. 点击 **Add a variable** → **Add a single variable**
3. 按 `.env.example` 的每一项添加

⚠️ `SUPABASE_SERVICE_ROLE_KEY` 和 `TIKTOK_APP_SECRET` 属于高度敏感信息,千万不要提交到 Git。

---

## 二、Supabase 数据库设置

### 1. 执行 Schema 迁移

1. 登录 https://supabase.com 打开你的项目
2. 左侧菜单 → **SQL Editor** → **New query**
3. 复制 `supabase/migrations/001_ads_schema.sql` 的全部内容粘贴进去
4. 点击 **Run**
5. 验证:左侧 **Table Editor** 切换 schema 到 `ads`,应该能看到 8 张表

### 2. 暴露 ads schema 给 API

Supabase 默认只暴露 `public` schema,要让 ads schema 可访问:

1. **Project Settings** → **API**
2. **Exposed schemas** 里加上 `ads`
3. 保存

### 3. 插入第一条测试数据

在 SQL Editor 执行:

```sql
-- 手动插入一条越南 TikTok 店铺账户(授权流程跑通后会自动更新)
INSERT INTO ads.accounts (
  platform, market, external_account_id, account_name,
  currency, timezone, operator_code
) VALUES (
  'tiktok_shop', 'VN', 'placeholder_vn', '欣远-越南-TikTok',
  'VND', 'Asia/Ho_Chi_Minh', 'OP01'
);
```

---

## 三、TikTok Shop 应用配置

回到截图里那个 Partner Center 的表单,这样填:

| 字段 | 值 |
|---|---|
| Target market | 越南(已选) |
| 商家类型 | 跨境商家(已选) |
| 跨境商家所在国家 | 中国(已选) |
| 启用 API | ✅ 开(已选) |
| **重定向链接** | `https://xinyuan-ads.netlify.app/api/auth/tiktok/callback` |

点 **创建** 提交审核。审核通过后,在应用详情页能看到 **App Key** 和 **App Secret**,复制到 Netlify 环境变量。

---

## 四、测试授权流程

所有配置就绪后:

1. 本地启动:`npm run dev`
2. 浏览器访问:`http://localhost:3000/api/auth/tiktok/authorize`
   - 本地测试需要用 ngrok 把 localhost 暴露成 https,或者先部署到 Netlify 测试
3. 跳转到 TikTok 授权页,用店主账号登录并同意
4. 自动跳回 `/auth/result?status=success`
5. 检查 Supabase `ads.accounts` 表,应该能看到 access_token 和 refresh_token 被写入

---

## 五、项目结构

```
xinyuan-ads/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── auth/
│   │   │       └── tiktok/
│   │   │           ├── authorize/route.ts   # 发起授权
│   │   │           └── callback/route.ts    # 接收回调并存 token
│   │   ├── auth/
│   │   │   └── result/page.tsx              # (待创建)授权结果页
│   │   ├── dashboard/                       # (待创建)广告数据看板
│   │   └── page.tsx
│   └── lib/
│       ├── supabase/
│       │   ├── client.ts                    # 浏览器端 Supabase 客户端
│       │   └── server.ts                    # 服务端 Supabase 客户端
│       └── tiktok/
│           └── auth.ts                      # TikTok OAuth 工具函数
├── supabase/
│   └── migrations/
│       └── 001_ads_schema.sql               # ads schema 定义
├── .env.example
├── .env.local                               # (本地)真实环境变量,勿提交
└── README.md
```

---

## 六、下一步路线图

### 第一阶段(当前)✅
- [x] 项目初始化 + Supabase schema
- [x] TikTok OAuth 授权流程
- [ ] **TikTok Shop 应用审核通过**(等官方)
- [ ] 跑通第一次授权,拿到真实 token

### 第二阶段
- [ ] 实现 TikTok Shop Marketing API 数据拉取
- [ ] 开发 Supabase Edge Function 做日度增量同步
- [ ] 接入汇率 API,自动更新 `ads.exchange_rates`
- [ ] 开发广告数据看板页面

### 第三阶段
- [ ] Shopee Open Platform 接入
- [ ] Claude API 异常检测和归因分析
- [ ] 飞书日报自动推送
- [ ] 自然语言查询(运营直接问问题)

### 第四阶段
- [ ] 智能出价建议
- [ ] 广告和商品管理系统打通(通过 SKU 关联)
- [ ] L1-L5 运营权限分级(对接之前的 SOP 体系)

---

## 七、常见问题

**Q: TikTok 应用审核要多久?**
A: 一般 3-7 个工作日。审核期间可以先做其他准备工作,比如完善 UI、写数据同步逻辑的框架代码。

**Q: 本地开发怎么测试 OAuth?**
A: TikTok 要求回调地址是 https,所以有三种方式:
  1. 用 ngrok 把 localhost 暴露成 https,并把 ngrok 地址临时加到 Partner Center 的回调列表
  2. 直接部署到 Netlify 的 deploy preview 分支测试
  3. 在 TikTok 应用里配置多个回调地址(如果平台允许)

**Q: access_token 过期怎么办?**
A: `src/lib/tiktok/auth.ts` 里已经有 `refreshAccessToken` 函数。需要再写一个定时任务(Supabase Edge Function 或 Netlify Scheduled Function),每天检查即将过期的 token 并自动刷新。

**Q: 为什么 ads.accounts 里存 token 而不是另起一张 oauth_tokens 表?**
A: 两种设计都合理。当前方案简单(一个账户一条记录包含所有信息)。如果未来要支持一个账户多个授权场景(比如读写权限分离),可以拆出独立的 tokens 表。

---

## 八、安全注意事项

1. **绝对不要把 `SUPABASE_SERVICE_ROLE_KEY` 或 `TIKTOK_APP_SECRET` 提交到 Git**
2. `access_token` 和 `refresh_token` 存在数据库里建议用 Supabase Vault 加密,当前 schema 先以明文存储,上线前务必加密
3. OAuth 回调接口已经有 state 防 CSRF,不要删除这个逻辑
4. 生产环境的 Netlify 站点要开启 **HTTPS only**(默认已开)
5. `ads.accounts` 表已开启 RLS,后续按运营角色细化策略

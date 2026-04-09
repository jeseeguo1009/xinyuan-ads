# CLAUDE.md

此文件是 Claude Code 的项目上下文。每次开启新会话时 Claude Code 会自动读取此文件。

## 项目概述

**项目名**:xinyuan-ads(欣远电商广告数据 Agent)

**业务背景**:
欣远电商是一家跨境电商公司,主营女鞋,在 TikTok Shop 和 Shopee 两个平台、东南亚六国(泰国、越南、菲律宾、马来西亚、印尼、新加坡)运营店铺。公司约 10 人,分运营、产品/采购、视觉/创意三个部门。

**项目定位**:
构建"运营智能层",叠加在现有的店小秘(订单商品中台)和海外仓 ERP(库存发货)之上,解决**数据统计、异常判断、报告生成、智能分析**等运营重复工作。第一阶段聚焦广告数据 Agent,后续扩展为全局运营看板 + 智能日报 + 客服 Agent + 评价分析 Agent。

**核心原则**:
1. 不重复造轮子 —— 店小秘和海外仓 ERP 已解决的问题不碰
2. Agent 只做"分析和建议",不自动执行写操作(改广告、下架商品必须人工确认)
3. 所有 Agent 共享同一套基础设施(Supabase + Claude API + 飞书机器人)
4. 分阶段交付 —— 每个阶段结束都有可用产出

详细架构见 `docs/01-architecture.md`,第二阶段规划见 `docs/02-phase2-dashboard.md`。

---

## 技术栈

**前端**:
- Next.js 15(App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts(图表)

**后端**:
- Next.js API Routes(轻量接口)
- Supabase Edge Functions(Deno/TypeScript,定时任务和重活)
- GitHub Actions(历史数据回填等超长任务)

**数据层**:
- Supabase(PostgreSQL)
- 使用独立 schema `ads` 隔离广告数据(未来还会加 `sales`、`inventory`、`reviews`)
- 启用 RLS

**智能层**:
- Claude API(model: `claude-sonnet-4-6`)
- 用于异常检测、日报生成、自然语言查询

**部署**:
- Netlify(前端和 API Routes)
- 站点域名:`https://xinyuan-ads.netlify.app`
- Supabase 托管数据库

**通知**:
- 飞书机器人 Webhook(推送日报和异常告警)

---

## 目录结构

```
xinyuan-ads/
├── CLAUDE.md                 # 本文件
├── README.md                 # 项目说明和初始化指南
├── .env.example              # 环境变量模板
├── .gitignore
├── docs/
│   ├── 01-architecture.md    # 整体架构设计
│   └── 02-phase2-dashboard.md # 第二阶段详细规划
├── supabase/
│   └── migrations/
│       └── 001_ads_schema.sql # ads schema 定义(8 张表 + 视图 + RLS)
└── src/
    ├── app/
    │   └── api/
    │       └── auth/
    │           └── tiktok/
    │               ├── authorize/route.ts  # 发起 OAuth
    │               └── callback/route.ts   # 接收回调换 token
    └── lib/
        ├── supabase/
        │   ├── client.ts     # 浏览器端客户端
        │   └── server.ts     # 服务端客户端(含 Service Role)
        └── tiktok/
            └── auth.ts       # TikTok OAuth 工具函数
```

---

## 当前进度

### ✅ 已完成

1. 项目规划和架构设计(`docs/` 下的两份文档)
2. Supabase `ads` schema SQL(8 张表、1 个视图、RLS 策略、触发器)
3. TikTok OAuth 完整流程代码(authorize → callback → 写库)
4. Supabase 客户端工具(anon 和 service role 两种模式)
5. 项目 README 和环境变量模板

### 🔨 进行中 / 待办(按顺序)

**第 1 周:让项目"活"起来**
- [ ] 在 TikTok Partner Center 提交应用审核(用户已在做)
- [ ] 在 Supabase 执行 `001_ads_schema.sql`,并在 Exposed schemas 添加 `ads`
- [ ] `npx create-next-app@latest` 初始化 Next.js 项目,复制已有代码进去
- [ ] 安装依赖:`@supabase/supabase-js @supabase/ssr @anthropic-ai/sdk date-fns`
- [ ] 初始化 shadcn/ui
- [ ] 推 GitHub + 连接 Netlify + 配置环境变量
- [ ] 做极简首页(标题 + 已连接店铺列表 + 连接按钮)
- [ ] 做 `/auth/result` 授权结果页

**第 2 周:假数据 + 看板雏形**
- [ ] 写种子数据脚本,往 Supabase 塞 6 店铺 × 30 天模拟数据
- [ ] 首页改造:6 店铺矩阵 + 核心指标卡片
- [ ] `/shops/[id]` 单店铺详情页(趋势图 + 广告活动列表)
- [ ] 基础组件库:指标卡片、趋势图、数据表格

**第 3 周:汇率 + 第一个 Agent**
- [ ] Supabase Edge Function:每天拉取汇率(中行 API)
- [ ] Supabase Edge Function:每天 8:30 生成广告日报(Claude API)
- [ ] 飞书 Webhook 推送集成
- [ ] 首页加"每日洞察"模块

**第 4 周及以后:接入真实数据**
- [ ] 配置 TikTok App Key(审核通过后)
- [ ] 跑通第一次真实 OAuth
- [ ] 实现 TikTok Marketing API 数据拉取(campaigns / ad_groups / ads / metrics 四个接口)
- [ ] Supabase Edge Function 定时同步
- [ ] Shopee Open Platform 接入

详细每周计划见本次会话给用户的路线建议。

---

## 关键设计决策(已确定,不要质疑)

1. **数据库 schema 用 `ads` 隔离**,不要放到 `public` schema
2. **花费和 GMV 双币种存储**:`spend_local` + `spend_cny` + `exchange_rate`,便于追溯
3. **衍生指标(ROI/CTR/CPC 等)预先存储**,不做实时计算,加快查询
4. **OAuth token 先明文存储**,上线前改用 Supabase Vault 加密
5. **Agent 只读,不写**:绝对不要让 Agent 自动调整广告、下架商品等"写操作"
6. **SKU 命名系统**:用户已有的格式是 `WS-HH-PS-03-25001-BK-38`,`ads.ads` 表的 `sku_code` 字段用这个格式
7. **运营代码 `operator_code`**:和 SKU 命名系统里的运营代码对应,用于归因分析

---

## 环境变量清单

开发所需环境变量(见 `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # 服务端专用,严禁暴露
TIKTOK_APP_KEY=                     # 等审核通过后填
TIKTOK_APP_SECRET=                  # 等审核通过后填
TIKTOK_REDIRECT_URI=https://xinyuan-ads.netlify.app/api/auth/tiktok/callback
NEXT_PUBLIC_APP_URL=https://xinyuan-ads.netlify.app
ANTHROPIC_API_KEY=
FEISHU_WEBHOOK_URL=
```

---

## 开发规范

**代码风格**:
- TypeScript 严格模式
- 优先使用 async/await,不用 .then()
- 组件文件用 kebab-case(`shop-card.tsx`),组件名用 PascalCase(`ShopCard`)
- API Route 用 `route.ts`,导出 `GET`/`POST` 等命名函数

**注释语言**:中文注释(用户是中文母语者),代码本身保持英文标识符

**提交规范**:Conventional Commits(`feat:`、`fix:`、`docs:`、`chore:` 等)

**分支策略**:
- `main` 是生产分支,自动部署到 Netlify
- 新功能在 `feature/xxx` 分支开发,通过 PR 合并
- 紧急修复用 `fix/xxx`

---

## 用户信息

用户名:Jesee(机器 username: `guojiangwei`)
设备:MacBook Air
沟通语言:中文
技术背景:对前端和全栈开发有一定了解,正在深入学习 Claude Code 工作流
偏好:喜欢迭代式开发、具体可交付的成果,不喜欢过度抽象的框架讨论

---

## 常见操作备忘

**启动本地开发**:
```bash
npm run dev
```

**执行 Supabase migration**(本地 CLI 方式,可选):
```bash
supabase db push
```
或者直接在 Supabase 网页版 SQL Editor 粘贴 SQL 执行。

**部署到 Netlify**:推送到 `main` 分支自动触发部署。

**查看 Netlify 日志**:
```bash
netlify logs:function <function-name>
```

---

## 下一步:第一个具体任务

**任务 A(用户已在做)**:
在 TikTok Partner Center 的回调地址栏填入 `https://xinyuan-ads.netlify.app/api/auth/tiktok/callback`,点击创建让审核开始。

**任务 B(Claude Code 接手后的第一件事)**:
初始化 Next.js 项目骨架并把已有的 OAuth 代码整合进去。具体步骤:
1. 用户在工作目录执行 `npx create-next-app@latest xinyuan-ads`(选项见 README.md)
2. Claude Code 把 `src/lib/`、`src/app/api/` 下的已有文件复制/创建到新项目
3. 创建 `src/app/auth/result/page.tsx`(授权结果页,当前还没有)
4. 创建极简首页 `src/app/page.tsx`
5. 配置 `.env.local`
6. `npm run dev` 验证能跑起来
7. 初始化 Git 和 GitHub
8. 连接 Netlify 并部署

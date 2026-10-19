# Nano-job-Tracker

一个网申求职**全生命周期闭环**：投递前用 Agent 判断「这个岗位值不值得投」，投递后用邮件同步追踪「投出去之后怎么样了」。

两个模型各司其职，通过一层极薄的 HTTP 边界拼接：

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  前端 / 追踪  (Next.js)     │         │  后端 / 大脑  (nanobot)      │
│  模型：Claude               │         │  模型：DeepSeek              │
│                             │         │                              │
│  · Gmail Email Sync         │         │  · Memory  长期记忆 CV       │
│  · 邮件分类 / 信息抽取      │  HTTP   │  · Extraction  拆解 JD       │
│  · 状态流转 / 三态聚合      │ ──────► │  · Reasoning   CV × JD 匹配  │
│  · Dashboard 展示           │ ◄────── │                              │
│                             │  JSON   │  OpenAI 兼容 /v1/chat/...    │
└─────────────────────────────┘         └──────────────────────────────┘
   本仓库 src/ + prisma/                 HKUDS/nanobot（单独 clone）
                                          （独立进程，源码零改动）
```

前端基于 [viviannnl/job-tracker](https://github.com/viviannnl/job-tracker)（原 README 保留为
[README.upstream.md](./README.upstream.md)），在它的 Gmail 同步与 Claude 链路上做了大量改造；
[HKUDS/nanobot](https://github.com/HKUDS/nanobot) 一行源码没改，全部行为由
`agent/skills/job-analysis/SKILL.md` 定义。来源与许可见文末。

---

## 目录

```
nano-job-tracker/
├── src/
│   ├── lib/nanobot/          ← 对接层，整个融合就这一个目录
│   │   ├── client.ts         · OpenAI 兼容端点的 fetch 封装
│   │   ├── schemas.ts        · zod 契约
│   │   └── analyze.ts        · 指令构造 + JSON 提取 + 校验
│   ├── actions/nanobot.ts    · server actions
│   ├── app/analyze/          · 投前 JD 分析页
│   ├── app/cv/               · 简历录入页
│   └── lib/llm/              · 原有 Claude 链路（邮件分类/抽取/面试准备）
├── prisma/                   · schema + migrations + dev.db
└── agent/
    ├── skills/job-analysis/SKILL.md   ← 技能定义（源）
    └── scripts/
        ├── install-skill.ps1          · 同步技能到 ~/.nanobot/workspace
        └── start-engine.ps1           · 启动 nanobot API 服务
```

---

## 界面在哪

导航顺序 **`1 · My CV → 2 · Analyze JD → 3 · Tracker`** 不是审美选择，是依赖顺序：
CV 定义用户画像，画像同时喂给 **JD 匹配**和**邮件分类**。没有 CV，分类器不知道
对这个人来说什么算「求职邮件」。

| 路由 | 干什么 | 谁在算 |
|------|--------|--------|
| `/cv` | 上传 PDF/Word 自动填充结构化表单，字段级编辑；**Save CV** 一次写两处：nanobot 长期记忆（给 JD 分析）+ 数据库（给邮件分类） | DeepSeek |
| `/analyze` | 投递**前**粘 JD，出匹配点 / Gap / 关键词 / 建议 / S-A-B-C 评级；全部分析按公司分组，可搜索、排序、手动编辑、删除 | DeepSeek |
| `/` | Update / Re-judge / Reset 三个按钮，追踪窗口与本月用量；可收起的时间线；四栏 Stage（Applied / Interviewing / Offers / Rejected）；按公司分组的卡片（可手动合并同一家公司、可删误报）；三态漏斗 | Claude（点按钮时） |
| `/applications/[id]` | 单个岗位：状态可手改、可删除；按需生成公司速览 / 面试准备 / 行为题 | Claude（点生成时） |

右上角有 `nanobot online/offline` 探活灯——引擎没起时是灰的，分析失败时你能一眼
分清「引擎没开」还是「分析本身出错」。

### 邮件triage 由 CV 驱动，不由关键词表驱动

Gmail 查询只按时间取邮件（Update 从上次同步处接着拉，Reset 按你选的日期范围），外加
`-in:chat`。它**不**排除促销/社交标签页（ATS 和招聘邮件
大量落在那里），也**没有**关键词或发件域名白名单——那种白名单会在任何模型看到邮件
之前就替它做判断，而且必然编码某一个人的行业、语言和常用招聘网站。

判断谁是求职邮件的是分类器，它的提示词分两块：

- `BASE_PROMPT` — 通用规则，所有用户一致
- `<user_profile>` — 由 [`src/lib/cv/profile.ts`](src/lib/cv/profile.ts) **从用户自己的 CV 生成**
  （求职意向、所在地、教育、待过的公司、技能）；没有 CV 时用通用兜底

profile 块明确写了「用画像消歧，不用画像排除」——人会投画像之外的岗位，兼职也算。

成本护栏：`SYNC_MAX_EMAILS`（默认 4000）限制单次同步的邮件数，Gmail 按时间倒序返回，
超限时保留最新的。

### LLM 输出的降级方向

三处 LLM 调用（分类、抽取、JD 分析）都走「结构化输出约束 + zod 校验」。校验失败时
**绝不写入一个假的答案**：

- 分类失败 → 返回空，邮件保持 `isJobRelated = null`，下次同步重试
- 抽取失败 → 打日志说明有几封邮件不会变成卡片，`extractedAt` 保持空以便重试

这条规则是踩出来的。早期版本分类失败会把整批 12 封标成「非求职」——和真实判断
长得一模一样，等于永久掩埋。一次全量扫描里 25 个批次这样失败，埋掉 300 封邮件。

## 日常维护：三个按钮

Tracker 页顶部三个按钮，覆盖了以前要跑脚本的全部场景：

| 按钮 | 做什么 | 什么时候用 |
|---|---|---|
| **Update** | 从上次同步处（留 1 天重叠）拉到现在，只判断新邮件 | 日常 |
| **Re-judge** | 只重判「被否决、但分类器没把握」的邮件，且只在 CV 画像变过之后才有东西可判；分类器确定是群发广告的邮件永久跳过 | 改了 CV 之后 |
| **Reset** | 按你选的日期范围清空重来：范围内的邮件全部重判、重建卡片，范围外的删掉。起点默认是当前追踪窗口的起点（还没有窗口时为最近半年），执行前报邮件封数和预估费用 | 首次使用，或想换追踪范围 |

Re-judge 和 Reset 都是先预览、再二次确认才执行。页面上方显示当前追踪窗口
（如 `3/1 – 9/4 15:15 · via Update`），以及按真实 API 用量记账的本月花费。

开发用脚本（正常使用用不到）：

```bash
# 只重算卡片，不调用任何 LLM（改了 merge.ts 之后跑）。会撤销手动删卡和手改的状态
npx tsx scripts/rebuild-applications.mts

# 导出「分类器拿不准」的邮件清单到 docs/private/data/，只读、不花钱
npx tsx scripts/export-uncertain.mts
```

### 状态设计

数据层保留原有五态 `APPLIED / OA / INTERVIEW / OFFER / REJECTED`（邮件同步直接产出），
Dashboard 顶部叠一层三态聚合视图：

```
Pending = APPLIED + OA + INTERVIEW
Success = OFFER
Fail    = REJECTED
成功率  = Success / (Success + Fail)
```

映射表在 `src/lib/types.ts` 的 `STATUS_TO_OUTCOME`。三态是**视图**不是存储——
邮件同步逻辑完全没动，两种粒度都能展示。

---

## 关键设计：CV 只存在于 nanobot 的记忆里

分析请求**不携带简历**。发过去的只有 `[NJT:ANALYZE]` + JD 原文，简历要靠 Agent
自己从 `workspace/memory/CV.md` 里回忆出来。

这是刻意的：如果每次都把 CV 拼进 prompt，"长期记忆"就只是个装饰词，整条链路
退化成一次无状态的 LLM 调用。让 Agent 自己去读记忆，Memory 才是真的在工作。

数据库里的 `CvProfile` 表只是编辑器的本地镜像，用于即时渲染和防止 nanobot 离线时
丢失用户输入——它不参与分析。

---

## 从零部署

需要两个东西各跑一次配置：**nanobot 引擎**（Python）和**本应用**（Node）。
两者独立进程，通过 `127.0.0.1:8900` 通信。

### 前置

| | 版本 | 说明 |
|---|---|---|
| Node.js | 20+ | 跑 Next.js |
| Python | 3.11+ | 跑 nanobot |
| DeepSeek API key | — | [platform.deepseek.com](https://platform.deepseek.com)，JD 分析用 |
| Anthropic API key | — | [console.anthropic.com](https://console.anthropic.com)，邮件分类/抽取用 |
| Google Cloud 项目 | — | Gmail 只读授权 |

### 第 1 步：装 nanobot 引擎

把 nanobot clone 到**本项目旁边**（同一个父目录下），`npm run engine` 会按内容自动找到它；
放在别处的话，启动前设环境变量 `NANOBOT_SOURCE` 指向它。

```bash
git clone https://github.com/HKUDS/nanobot
cd nanobot
python -m venv .venv
```

Windows 用 `.\.venv\Scripts\python.exe`，macOS/Linux 用 `.venv/bin/python`：

```bash
.venv/bin/python -m pip install -e ".[api]"
.venv/bin/python -m nanobot onboard
```

`onboard` 会引导你填 provider。选 **deepseek**，填 API key。之后确认
`~/.nanobot/config.json` 里有：

```json
{
  "agents": { "defaults": { "provider": "deepseek", "model": "deepseek-v4-flash" } },
  "api": { "host": "127.0.0.1", "port": 8900 }
}
```

### 第 2 步：装本应用

```bash
git clone <this repo>
cd nano-job-tracker
npm install
cp .env.example .env.local
```

填 `.env.local`（每一项的含义见下方**环境变量**）。然后装技能定义——
这一步不能跳，Agent 的全部行为都由它定义：

```bash
npm run install-skill
```

它把 `agent/skills/job-analysis/SKILL.md` 复制到 `~/.nanobot/workspace/skills/`。

### 第 3 步：配 Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com) 建项目 → 启用 **Gmail API**
2. **APIs & Services → Credentials → Create OAuth client ID → Web application**
3. Authorized redirect URI 填 `http://localhost:3000/api/auth/callback/google`
4. 把 client ID / secret 写进 `.env.local`
5. **APIs & Services → OAuth consent screen**：
   - Scopes 加 `https://www.googleapis.com/auth/gmail.readonly`
   - **Publishing status 一定要设成 “In production”**。留在 “Testing” 的话
     Google 签发的 refresh token **7 天后强制失效**，邮件同步每周都会断。
     未验证的应用在生产状态下依然可用（授权时多一个警告页，上限 100 用户）。

### 第 4 步：跑起来

两个终端，都要开着：

```bash
npm run engine
```

```bash
npm run dev
```

`npm run dev` 会自动执行 `prisma migrate deploy && prisma generate && seed`，
数据库不用手动初始化。打开 http://localhost:3000。

> 引擎必须先起。前端右上角的 `nanobot online/offline` 灯就是探活——灰的说明
> 引擎没通，JD 分析会直接报 OFFLINE 而不是给你一个假结果。

### 第 5 步：走一遍闭环

1. `/cv` → 上传 PDF/Word（或手填）→ 核对字段 → **Save CV**（同时写进 nanobot 记忆和数据库）
2. `/analyze` → 粘一份 JD → **Analyze with nanobot**
3. Tracker → **Reset**（首次打开会自动展开）：选追踪范围 → 看封数和预估费用 → 确认。
   按邮箱大小需要几分钟
4. 之后日常点 **Update**；改了 CV 就看一眼 **Re-judge** 有没有要重判的

### 不装 Google OAuth 也能看

`GOOGLE_CLIENT_ID` 留空即进入 **demo 模式**：跳过登录，用 `prisma/seed.ts` 里的
示例数据渲染整个界面。适合先看看长什么样再决定要不要接自己的邮箱。

---

## 协议

前端与 Agent 之间只有两条指令，全部定义在 `agent/skills/job-analysis/SKILL.md`：

| 指令 | 输入 | 输出 |
|------|------|------|
| `[NJT:CV_PARSE]` | 简历原始文本（PDF/Word 抽出，排版可能已乱） | 结构化 CV 字段。**只解析不写记忆**——用户先在表单里核对 |
| `[NJT:CV_UPDATE]` | 简历全文 | `{ok, summary:{headline, years, skills[], highlights[]}}`，同时写入 `memory/CV.md` |
| `[NJT:ANALYZE]` | JD 原文 | `{ok, company, role, rating, matchScore, verdict, matches[], gaps[], keywords[], suggestions[]}` |

记忆为空时 `[NJT:ANALYZE]` 返回 `{"ok": false, "error": "NO_CV"}`，前端据此把用户引导到 `/cv`。

Agent 的输出比裸 completion 更啰嗦，所以 `src/lib/nanobot/analyze.ts` 会先剥掉代码围栏
和寒暄，再取第一个 `{` 到最后一个 `}`，然后过一遍 zod。校验失败就报错，不会把半截
JSON 写进库。

### 会话与记忆

| 用途 | session_id |
|------|-----------|
| 简历写入 | `njt:cv:<userId>` |
| JD 分析 | `njt:analyze:<userId>` |

两个会话的短期上下文隔离，但长期记忆（`memory/`）是工作区级的——所以 cv 会话写进去的
简历，analyze 会话能读到。这正是拆成两个会话还能协同的原因。

---

## 环境变量

`.env.local`（已 gitignore）：

```
AUTH_SECRET="..."           # npx auth secret
GOOGLE_CLIENT_ID="..."      # 留空则进 demo 模式，用种子数据
GOOGLE_CLIENT_SECRET="..."
ANTHROPIC_API_KEY="..."     # 邮件分类/抽取/面试准备用

NANOBOT_API_URL="http://127.0.0.1:8900"
NANOBOT_API_KEY=""          # 仅当 ~/.nanobot/config.json 配了 api.apiKey
NANOBOT_MODEL="deepseek-v4-flash"
NANOBOT_TIMEOUT_MS="180000" # Agent 要读文件再推理，比裸调用慢
```

DeepSeek 的 key 不在这里——它在 nanobot 自己的 `~/.nanobot/config.json` 里，
前端从不接触 DeepSeek 凭证。

---

## 已知限制

- **`npm run engine` / `npm run install-skill` 目前只支持 Windows**（PowerShell 脚本）。
  mac / Linux 先手动代替：在 nanobot 目录里跑 `.venv/bin/python -m nanobot serve`；装技能用
  `mkdir -p ~/.nanobot/workspace/skills/job-analysis && cp agent/skills/job-analysis/SKILL.md ~/.nanobot/workspace/skills/job-analysis/`。
- **Google OAuth 应用未经 Google 验证**：每次授权都会多一个「此应用未经 Google 验证」警告页，
  上限 100 个用户。这是自用 / 小范围使用的正常状态。
- 只在 Windows + Node 22 上完整跑过。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 登录时 Google 提示「此应用未经 Google 验证」 | 你自己建的 OAuth 应用没走 Google 审核。点「高级」→「转至…（不安全）」→ 勾上 Gmail 只读权限 → 继续。不要点「返回到安全网页」，那是取消 |
| `npm run dev` 报 `EPERM … query_engine-windows.dll.node` | 已经有一个 dev server 在跑，占着 Prisma 引擎文件。网页能打开就不用再开；要重启先在原来的终端按 Ctrl+C |
| 页面报 `Unexpected token '<'` 或显示 `(stale)` | 改了 `prisma/schema.prisma`、删了文件或动了 `node_modules` 之后没重启 dev server。重启即可 |
| JD 分析报 `OFFLINE` | nanobot 引擎没开，先 `npm run engine`，右上角灯变绿再试 |

## 你的数据去了哪里

- **全部留在本机**：邮件、卡片、简历、Google 令牌都存在 `prisma/dev.db`（已 gitignore）；
  API key 在 `.env.local`（已 gitignore）；DeepSeek 的 key 在 `~/.nanobot/config.json`。
- **会发给 Anthropic 的**：分类时每封邮件的发件人、标题和约 200 字预览；判为求职邮件的，
  抽取时再发正文前 6,000 字。
- **会发给 DeepSeek（经 nanobot）的**：你的简历和你粘贴的 JD。
- Gmail 授权是**只读**的（`gmail.readonly`），程序不能发信、不能删信。

## 来源与许可

- 前端改造自 [viviannnl/job-tracker](https://github.com/viviannnl/job-tracker)。上游仓库**没有声明许可证**，
  本项目的公开许可待与原作者确认后补充；在此之前请勿把本仓库代码用于再分发。
- 分析引擎是 [HKUDS/nanobot](https://github.com/HKUDS/nanobot)（MIT License，
  Copyright (c) 2025-present Xubin Ren and the nanobot contributors）。本仓库**不包含** nanobot 源码，
  只通过它的 HTTP 接口调用，并提供一份技能定义文件。

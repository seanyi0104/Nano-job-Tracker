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

> **怎么用、三个按钮各是什么逻辑**，看写给使用者的 [使用指南](docs/GUIDE.md)。
> 本页讲怎么装、怎么跑、为什么这么设计。

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
├── agent/skills/job-analysis/SKILL.md   ← 技能定义（源）
└── scripts/
    ├── engine.mjs           · npm run engine：找到并启动 nanobot（跨平台）
    └── install-skill.mjs    · npm run install-skill：同步技能到 ~/.nanobot/workspace
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

让 Agent 自己回忆，就得能证明它真的回忆了。所以做了两件事：

- **每次调用 nanobot 都开一个新会话**。对话里没有旧简历可抄，只能去读 `CV.md`。
- **简历带版本号**。Save CV 时，`CV.md` 顶部会写入一个版本号（简历内容的哈希）。分析结果
  必须带回本次从文件里读到的版本号，和当前简历对不上就报错、不入库。简历改过之后，旧分析
  底部会标「Based on an older CV」，要不要点 Re-analyze 重跑由你决定。

这两条是踩坑踩出来的。最初每个用户共用一个分析会话，Agent 第一次读完 `CV.md` 之后，就一直
拿对话记录里那份旧简历打分。中间简历改了好几次它都没发现，每次输出看上去又都正常。

数据库里的 `CvProfile` 不参与 JD 分析，但它是**邮件分类画像的来源**：
`src/lib/cv/profile.ts` 从这里抽 5 行（求职意向、所在地、学历、雇主、技能）。
Save CV 先写数据库、再推给 nanobot，所以不开 nanobot 时，手填的简历照样能让
邮件追踪按你的背景工作。

---

## 从零部署

先决定装到哪一档——不是每样都必须：

| 档位 | 要准备的 | 能用的功能 |
|---|---|---|
| 只看看 | Node.js | 演示模式：不登录，用示例数据看完整界面（见下方「不装 Google OAuth 也能看」） |
| 最小可用 | + Google OAuth 应用 + Anthropic key | 邮件追踪的全部功能（Update / Re-judge / Reset、卡片、面试准备）；简历手填 |
| 完整 | + nanobot + 一个模型的 key（默认 DeepSeek） | 再加：上传简历自动解析、投前 JD 分析 |

nanobot 和本应用是两个独立进程，通过 `127.0.0.1:8900` 通信。

### 前置

| | 版本 | 说明 |
|---|---|---|
| Node.js | 20+ | 跑 Next.js |
| Python | 3.11+ | 跑 nanobot（完整档才要） |
| 模型 API key | — | 完整档才要。默认 DeepSeek（[platform.deepseek.com](https://platform.deepseek.com)），也可换成 nanobot 支持的其他厂商 |
| Anthropic API key | — | [console.anthropic.com](https://console.anthropic.com)，邮件分类/抽取用 |
| Google Cloud 项目 | — | Gmail 只读授权 |

### 第 1 步：装 nanobot 引擎（完整档才要）

**nanobot 是什么**：港大 HKUDS 开源的 Agent 框架。它在你电脑上跑一个后台程序，负责记住你的简历、
分析 JD。它本身**不是模型**，干活时调用云端模型的 API——默认 DeepSeek，也支持 OpenAI、Anthropic、
通义、智谱、Kimi、OpenRouter 等约 40 家，或 Ollama / LM Studio 这类本地模型。本项目没改它一行代码，
只给它一份技能文件（`agent/skills/job-analysis/SKILL.md`）。

两种装法，选一种：

**A. 用 pip 装（推荐）**

```bash
pip install "nanobot-ai[api]"
nanobot onboard
```

**B. 从源码装**：clone 到**本项目旁边**（同一个父目录），`npm run engine` 会自动找到它；
放在别处就设环境变量 `NANOBOT_SOURCE` 指向它。

```bash
git clone https://github.com/HKUDS/nanobot
cd nanobot
python -m venv .venv
.venv/bin/python -m pip install -e ".[api]"     # Windows：.venv\Scripts\python.exe
.venv/bin/python -m nanobot onboard
```

`onboard` 会让你选模型厂商、填 API key。之后确认 `~/.nanobot/config.json` 里 API 端口是 8900
（换了端口，就同时改本应用的 `NANOBOT_API_URL`）：

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

填 `.env.local`（每一项的含义见下方**环境变量**）。用 nanobot 的话，再装技能定义——
Agent 的全部行为都由它定义，这一步不能跳：

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

> **为什么要自己建**：这个应用跑在你自己的电脑上，Google 授权必须发给你自己的 OAuth 应用。
> 用别人的不行——对方的密钥会外泄，而且未经验证的应用最多只能给 100 个人用。

### 第 4 步：跑起来

完整档开两个终端（最小可用只要第二个）：

```bash
npm run engine
```

```bash
npm run dev
```

`npm run dev` 会自动执行 `prisma migrate deploy && prisma generate && seed`，
数据库不用手动初始化。打开 http://localhost:3000。

`npm run engine` 依次找：`NANOBOT_SOURCE` → 项目旁边的源码目录 → PATH 上的 `nanobot`。
找不到会告诉你怎么装；`npm run engine -- --dry-run` 只报告找到的是哪个，不启动。

> 用 nanobot 的话引擎要先起。前端右上角的 `nanobot online/offline` 灯就是探活——灰的说明
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
| `[NJT:CV_UPDATE]` | 版本号行 + 简历全文 | `{ok, summary:{headline, years, skills[], highlights[]}, cvVersion}`，同时写入 `memory/CV.md` |
| `[NJT:ANALYZE]` | JD 原文 | `{ok, company, role, rating, matchScore, verdict, matches[], gaps[], keywords[], suggestions[], cvVersion}` |

记忆为空时 `[NJT:ANALYZE]` 返回 `{"ok": false, "error": "NO_CV"}`，前端据此把用户引导到 `/cv`。

两条指令里的 `cvVersion`，都是 Agent 从 `memory/CV.md` 的版本号行读到的值（版本号的生成和读取在
`src/lib/nanobot/cv-version.ts`）。前端拿它和当前简历比对，对不上就拒收：写入时说明没写成功，
分析时说明没用最新简历。版本号只留在前端核对，从不随 JD 发出去，否则 Agent 不读文件也能照抄。

Agent 的输出比裸 completion 更啰嗦，所以 `src/lib/nanobot/analyze.ts` 会先剥掉代码围栏
和寒暄，再取第一个 `{` 到最后一个 `}`，然后过一遍 zod。校验失败就报错，不会把半截
JSON 写进库。

### 会话与记忆

| 用途 | session_id |
|------|-----------|
| 简历解析、写入 | `njt:cv:<userId>:<随机 id>` |
| JD 分析 | `njt:analyze:<userId>:<随机 id>` |

**每次调用一个新会话**。唯一的例外是简历解析的纠错重试：它和第一次请求共用一个会话，因为它要
让 Agent 看到自己上一次答错了什么。短期上下文用完即弃，长期记忆（`memory/`）是工作区级的，
所以写简历的会话写进去的东西，分析会话照样读得到。

为什么不让同一个用户的请求共用会话：nanobot 会把整段会话历史回放进每次请求。共用时，
Agent 会直接引用历史里读过的旧简历，不再重新读文件，长期记忆就被短期上下文挡住了；
历史还会越积越长，越来越贵。nanobot 的 `sessions/` 目录里每次调用会留一个文件，可以随时删。

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
NANOBOT_MODEL="deepseek-v4-flash" # 只是记在每条 JD 分析上的标签；真正用哪个模型在 nanobot 配置里改
NANOBOT_TIMEOUT_MS="180000" # Agent 要读文件再推理，比裸调用慢
```

模型的 key（默认 DeepSeek）不在这里——它在 nanobot 自己的 `~/.nanobot/config.json` 里，
前端从不接触这把 key。

---

## 已知限制

- **只支持 Gmail**。程序直接调 Gmail API，Outlook、QQ 邮箱、163 等现在都不行。
  零代码的办法：在那个邮箱里设置「自动转发到你的 Gmail」，求职邮件就会进到这里。
- **Google OAuth 应用未经 Google 验证**：每次授权都会多一个「此应用未经 Google 验证」警告页，
  上限 100 个用户。这是自用 / 小范围使用的正常状态。
- **引擎脚本在 Windows 上实测过**；macOS / Linux 走同一套 Node 脚本，按代码逻辑可用，但还没在真机上跑过。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 登录时 Google 提示「此应用未经 Google 验证」 | 你自己建的 OAuth 应用没走 Google 审核。点「高级」→「转至…（不安全）」→ 勾上 Gmail 只读权限 → 继续。不要点「返回到安全网页」，那是取消 |
| `npm run dev` 报 `EPERM … query_engine-windows.dll.node` | 已经有一个 dev server 在跑，占着 Prisma 引擎文件。网页能打开就不用再开；要重启先在原来的终端按 Ctrl+C |
| 页面报 `Unexpected token '<'` 或显示 `(stale)` | 改了 `prisma/schema.prisma`、删了文件或动了 `node_modules` 之后没重启 dev server。重启即可 |
| JD 分析报 `OFFLINE` | nanobot 引擎没开，先 `npm run engine`，右上角灯变绿再试 |
| JD 分析报 `did not answer from your current CV` | nanobot 记忆里的简历不是当前这份，或者是加版本号之前存的（从旧版本升级都会遇到一次）。去 My CV 点一次 Save CV，再分析。改过 `SKILL.md` 的话，先 `npm run install-skill` |

## 你的数据去了哪里

- **全部留在本机**：邮件、卡片、简历、Google 令牌都存在 `prisma/dev.db`（已 gitignore）；
  API key 在 `.env.local`（已 gitignore）；模型的 key（默认 DeepSeek）在 `~/.nanobot/config.json`。
- **会发给 Anthropic 的**：分类时每封邮件的发件人、标题和约 200 字预览；判为求职邮件的，
  抽取时再发正文前 6,000 字。
- **会发给你在 nanobot 里选的模型厂商（默认 DeepSeek）的**：你的简历和你粘贴的 JD。
- Gmail 授权是**只读**的（`gmail.readonly`），程序不能发信、不能删信。

## 来源与许可

- 前端改造自 [viviannnl/job-tracker](https://github.com/viviannnl/job-tracker)。上游仓库**没有声明许可证**，
  本项目的公开许可待与原作者确认后补充；在此之前请勿把本仓库代码用于再分发。
- 分析引擎是 [HKUDS/nanobot](https://github.com/HKUDS/nanobot)（MIT License，
  Copyright (c) 2025-present Xubin Ren and the nanobot contributors）。本仓库**不包含** nanobot 源码，
  只通过它的 HTTP 接口调用，并提供一份技能定义文件。

## 致谢

- [viviannnl/job-tracker](https://github.com/viviannnl/job-tracker)：本项目前端的原型。
- [HKUDS/nanobot](https://github.com/HKUDS/nanobot)：投递前 CV × JD 分析的 Agent 引擎。
- Claude（Anthropic）：参与了开发，提交记录里的 Co-Authored-By 署名即来自它。

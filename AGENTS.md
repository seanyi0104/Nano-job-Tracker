# Nano-job-Tracker

## 如果 `docs/private/CONTEXT-SNAPSHOT.md` 存在，先读它

那是维护者本地的交接文档：项目状态、踩过的坑及决策理由、协作约定。不读就动手，
大概率会重犯已经修过的错误。

`docs/private/` 只存在于维护者本地，不进版本控制。从 GitHub clone 来的话这个目录
不存在是正常的——读 [`README.md`](README.md) 了解架构即可。

## 三条最容易违反的工程约束

1. **JD 分析请求绝不携带简历。** CV 由 Agent 从 `workspace/memory/CV.md` 自己回忆。
   把 CV 拼进 prompt 会让「长期记忆」这个卖点变成装饰。
2. **绝不把某一个用户的特征硬编码进提示词或代码。** 这是要开源的项目，
   用户画像必须由该用户自己的 CV 生成（`src/lib/cv/profile.ts`）。
   这条已经踩过一次：分类器里曾写死一个人的求职方向，对任何其他用户都是负债。
3. **LLM 输出校验失败时，宁可报错、宁可留待重试，绝不写入一个长得像成功的假答案。**
   本项目三处 LLM 边界都因违反这条而静默丢过数据。

## 改动前的操作纪律

改 `prisma/schema.prisma`、删文件、动 `node_modules` 之前，**先停掉 dev server**。
运行中的进程感知不到这三类变化，会以「`(stale)` + 接口返回 HTML 而非 JSON」的形式报错，
很容易被误判成代码 bug。

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all
differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

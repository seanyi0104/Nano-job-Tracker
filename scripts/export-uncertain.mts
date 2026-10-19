/**
 * Export the emails the classifier was not sure about.
 *
 * These are the negatives it declined to stamp BULK_AD_TYPE — mail it ruled
 * out without being confident enough to rule out permanently. They are the
 * only part of the rejected pile a re-judge will ever revisit, so they are
 * also the only part worth a human glance when the question is "did it miss
 * something".
 *
 * Overwrites rather than appends, on purpose. The set is not a backlog that
 * grows; it drains and refills as verdicts change — an email re-judged into
 * job-related leaves it, new mail joins it. Appending would slowly turn the
 * file into a list of things that used to be uncertain, which is exactly the
 * kind of stale artefact that gets trusted and shouldn't be.
 *
 * Nothing reads this file. Re-judge decides what to re-examine from the
 * database (isJobRelated = false, not stamped, judged under an older profile);
 * this is a report, and deleting it changes no behaviour.
 *
 *   npx tsx scripts/export-uncertain.mts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const { PrismaClient } = await import("@prisma/client");
const { writeFileSync, mkdirSync } = await import("fs");
const { dirname } = await import("path");

const OUT = "docs/private/data/待核查-模型拿不准的邮件.md";

const prisma = new PrismaClient();

const user = await prisma.user.findFirst({
  where: { email: { not: { contains: "demo@jobtracker.local" } } },
  orderBy: { emails: { _count: "desc" } },
  select: { id: true, email: true },
});
if (!user) {
  console.error("No user with synced mail found.");
  process.exit(1);
}

const rows = await prisma.email.findMany({
  where: { userId: user.id, isJobRelated: false, emailType: "other" },
  orderBy: { internalDate: "desc" },
  select: { internalDate: true, fromAddress: true, subject: true },
});

// Reported alongside, because "nothing looks missed" only means something if
// every email actually got a verdict. A non-zero count here is the real
// warning sign — those were never judged at all.
const [total, unjudged, stamped] = await Promise.all([
  prisma.email.count({ where: { userId: user.id } }),
  prisma.email.count({ where: { userId: user.id, isJobRelated: null } }),
  prisma.email.count({ where: { userId: user.id, emailType: "bulk_ad" } }),
]);

const clean = (s: string | null) => (s ?? "").replace(/\|/g, "\\|").trim();
const byMonth = new Map<string, number>();
for (const r of rows) {
  const k = r.internalDate.toISOString().slice(0, 7);
  byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
}

const doc = [
  `# 模型「拿不准」的邮件 · ${rows.length} 封`,
  ``,
  `> 判为「非求职」但**没有**盖上群发广告章的那些——分类器自己不确定的部分。`,
  `> 这是 Re-judge 唯一会重新检查的范围；其余 ${stamped.toLocaleString()} 封盖了章的是确定噪音，永久跳过。`,
  `>`,
  `> **这份文件是导出的报告，没有任何程序读它。** Re-judge 的判断依据全在数据库里，`,
  `> 删掉这个文件不会改变任何行为。`,
  `>`,
  `> 每次运行 \`npx tsx scripts/export-uncertain.mts\` 会**整份重写**：`,
  `> 被重判成求职相关的会自动消失，Update 新产生的会自动出现。`,
  ``,
  `生成时间：${new Date().toLocaleString()}　·　账号：${user.email ?? user.id}`,
  ``,
  `## 完整性自检`,
  ``,
  `| 项 | 数值 | 说明 |`,
  `|---|---|---|`,
  `| 邮件总数 | ${total.toLocaleString()} | 追踪窗口内全部邮件 |`,
  `| **从未判过** | **${unjudged}** | **应为 0。不为 0 说明有邮件漏判，下次 Update 会自动补上** |`,
  `| 盖章跳过 | ${stamped.toLocaleString()} | 确定是群发广告，不再复查 |`,
  `| 拿不准 | ${rows.length} | 下表 |`,
  ``,
  `按月分布：${[...byMonth.entries()].sort().map(([k, v]) => `${k} (${v})`).join("　")}`,
  ``,
  `## 清单`,
  ``,
  `扫的时候只问一句：**这封是不是关于我自己的某次申请？**`,
  `发现看错了的，把日期告诉 Claude。`,
  ``,
  `| 日期 | 发件人 | 标题 |`,
  `|---|---|---|`,
  ...rows.map(
    (r) =>
      `| ${r.internalDate.toISOString().slice(0, 10)} | ${clean(r.fromAddress)} | ${clean(r.subject).slice(0, 90)} |`
  ),
  ``,
].join("\n");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, doc, "utf8");

console.log(`${OUT}`);
console.log(`  拿不准 ${rows.length} 封 · 盖章 ${stamped} 封 · 从未判过 ${unjudged} 封 / 共 ${total} 封`);
if (unjudged > 0) {
  console.warn(`  ⚠ 有 ${unjudged} 封从未判过 —— 跑一次 Update 会补上`);
}

await prisma.$disconnect();

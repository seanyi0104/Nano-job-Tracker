/**
 * Rebuild application cards from the extractions already stored on emails.
 *
 * Makes no LLM calls. Run this after changing the merge heuristics in
 * src/lib/applications/merge.ts — the cards are derived data, and editing the
 * rules does not retroactively re-derive them.
 *
 * It rebuilds from EVERY job-related email, so it undoes hand edits: a card
 * removed with the ✕ button comes back (its email is still job-related), and
 * statuses changed by hand are lost. Company merges survive — they are
 * display rules keyed on names, not rows. Not needed for normal use; Update,
 * Re-judge and Reset in the UI keep the cards current on their own.
 *
 *   npx tsx scripts/rebuild-applications.mts
 *
 * Pass --re-extract to also discard stored extractions and run them again
 * (costs Claude calls; needed after changing the extraction prompt).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { PrismaClient } = await import("@prisma/client");
const { runSync, rebuildApplications } = await import("../src/lib/gmail/sync");

const reExtract = process.argv.includes("--re-extract");
const p = new PrismaClient();

const user = await p.user.findFirst({
  where: { email: { not: "demo@jobtracker.local" } },
});
if (!user) throw new Error("No signed-in user found in the database.");

if (reExtract) {
  const reset = await p.email.updateMany({
    where: { userId: user.id, isJobRelated: true },
    data: { extractedAt: null, extractionJson: null },
  });
  console.log(`re-extracting ${reset.count} job-related emails via Claude ...`);
  await runSync(user.id);
}

await rebuildApplications(user.id);

const apps = await p.application.findMany({
  where: { userId: user.id },
  select: {
    company: true,
    role: true,
    status: true,
    _count: { select: { emails: true } },
  },
  orderBy: { lastEmailDate: "desc" },
});

const unlinked = await p.email.count({
  where: { userId: user.id, isJobRelated: true, applicationId: null },
});

console.log(`\n${apps.length} applications, ${unlinked} job-related emails unlinked`);
for (const a of apps) {
  console.log(`  [${a.status}] ${a.company} / ${a.role}  (${a._count.emails} emails)`);
}

process.exit(0);

"use server";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { NANOBOT_MODEL, NanobotError } from "@/lib/nanobot/client";
import {
  analyzeJdWithNanobot,
  pushCvToMemory,
  parseCvText,
  NoCvError,
} from "@/lib/nanobot/analyze";
import { JdAnalysisSchema } from "@/lib/nanobot/schemas";
import type { JdAnalysis } from "@/lib/nanobot/schemas";
import { StructuredCvSchema, renderCvMarkdown } from "@/lib/nanobot/cv-schema";
import type { StructuredCv } from "@/lib/nanobot/cv-schema";
import { extractCvText, UnsupportedCvFileError } from "@/lib/cv/extract-text";
import { countStaleVerdicts } from "@/lib/cv/profile";
import { runSync, runReset, countMessagesInRange } from "@/lib/gmail/sync";
import { BULK_AD_TYPE } from "@/lib/llm/schemas";
import {
  estimateSpend,
  getMeasuredRates,
  getUsageSummary,
} from "@/lib/llm/usage";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "NO_CV" | "OFFLINE" };

/**
 * Upload → text → fields. Nothing is written to nanobot memory yet: the user
 * reviews and corrects the parsed fields first, then saves.
 */
export async function parseCvUploadAction(
  formData: FormData
): Promise<ActionResult<{ cv: StructuredCv; sourceName: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file received" };
  }

  let rawText: string;
  try {
    rawText = await extractCvText(file);
  } catch (error) {
    if (error instanceof UnsupportedCvFileError) {
      return {
        ok: false,
        error: "Only PDF, .docx, .txt and .md are supported. Word .doc must be saved as .docx or PDF first.",
      };
    }
    return { ok: false, error: describe(error) };
  }

  if (rawText.trim().length < 50) {
    return {
      ok: false,
      error: "Almost no text came out of that file — if it is a scanned PDF, the text layer is missing.",
    };
  }

  try {
    const cv = await parseCvText(user.id, rawText);
    return { ok: true, data: { cv, sourceName: file.name } };
  } catch (error) {
    return {
      ok: false,
      error: describe(error),
      code: error instanceof NanobotError ? "OFFLINE" : undefined,
    };
  }
}

/**
 * Structure a CV that is already stored as plain text — the upgrade path for
 * anyone who pasted their CV before the form existed.
 */
export async function parseStoredCvAction(): Promise<
  ActionResult<{ cv: StructuredCv }>
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const profile = await prisma.cvProfile.findUnique({
    where: { userId: user.id },
    select: { content: true },
  });
  if (!profile?.content?.trim()) {
    return { ok: false, error: "No stored CV text to parse" };
  }

  try {
    const cv = await parseCvText(user.id, profile.content);
    return { ok: true, data: { cv } };
  } catch (error) {
    return {
      ok: false,
      error: describe(error),
      code: error instanceof NanobotError ? "OFFLINE" : undefined,
    };
  }
}

/**
 * Persist the structured CV and push the rendered Markdown into nanobot's
 * long-term memory.
 */
export async function saveStructuredCvAction(
  cv: StructuredCv,
  sourceName?: string
): Promise<ActionResult<{ headline: string | null }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = StructuredCvSchema.safeParse(cv);
  if (!parsed.success) {
    return { ok: false, error: "CV fields are not in the expected shape" };
  }

  const markdown = renderCvMarkdown(parsed.data);
  if (!markdown) return { ok: false, error: "CV is empty — fill in at least one section" };

  await prisma.cvProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      content: markdown,
      structuredJson: JSON.stringify(parsed.data),
      sourceName: sourceName ?? "Entered by hand",
      sourceAt: new Date(),
    },
    update: {
      content: markdown,
      structuredJson: JSON.stringify(parsed.data),
      ...(sourceName ? { sourceName, sourceAt: new Date() } : {}),
    },
  });

  try {
    const summary = await pushCvToMemory(user.id, markdown);
    await prisma.cvProfile.update({
      where: { userId: user.id },
      data: {
        summaryJson: JSON.stringify(summary),
        syncedAt: new Date(),
        syncError: null,
      },
    });
    revalidatePath("/cv");
    revalidatePath("/analyze");
    return { ok: true, data: { headline: summary.headline } };
  } catch (error) {
    const message = describe(error);
    await prisma.cvProfile.update({
      where: { userId: user.id },
      data: { syncError: message },
    });
    revalidatePath("/cv");
    return {
      ok: false,
      error: `Saved locally, but could not write to nanobot memory: ${message}`,
      code: error instanceof NanobotError ? "OFFLINE" : undefined,
    };
  }
}

/**
 * Re-judge the emails that were rejected under an older CV.
 *
 * Runs in the background like a normal sync, so the existing sync button and
 * status poller report progress. Positives keep their verdicts and their
 * extractions, so this only pays for the verdicts that are actually suspect.
 */
export async function rejudgeStaleEmailsAction(
  input?: DateRangeInput
): Promise<ActionResult<{ queued: number }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const state = await prisma.syncState.findUnique({
    where: { userId: user.id },
    select: { status: true },
  });
  if (state?.status === "running") {
    return { ok: false, error: "A sync is already running — wait for it to finish" };
  }

  let range: { start: Date; end: Date } | undefined;
  if (input) {
    const parsed = parseRange(input);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    range = parsed;
  }

  const { currentHash } = await countStaleVerdicts(user.id);
  const reset = await prisma.email.updateMany({
    where: {
      userId: user.id,
      isJobRelated: false,
      // The subtraction. Mass mail the classifier already settled is skipped
      // for good: "is this a promotion" is a fact about the message, not about
      // the person, so a new CV does not make it worth asking again. Without
      // this line every CV edit costs a full re-read of the whole inbox, which
      // is precisely the workflow this product wants people to use freely.
      emailType: { not: BULK_AD_TYPE },
      OR: [{ profileHash: null }, { profileHash: { not: currentHash } }],
      ...(range
        ? { internalDate: { gte: range.start, lte: range.end } }
        : {}),
    },
    data: { isJobRelated: null, emailType: null, classifiedAt: null },
  });

  if (reset.count === 0) {
    return { ok: true, data: { queued: 0 } };
  }

  // Fire and forget: runSync picks up everything left unclassified.
  runSync(user.id, { action: "rejudge" }).catch((err) => {
    console.error("Re-judge sync failed:", err);
  });

  revalidatePath("/");
  return { ok: true, data: { queued: reset.count } };
}

/** Ceiling a single unconfirmed run will take; mirrored from the sync module. */
const SYNC_CAP = Number(process.env.SYNC_MAX_EMAILS ?? 4000);

export interface DateRangeInput {
  start: string;
  end: string;
}

/**
 * Turn the two `<input type="date">` strings into a range.
 *
 * The end date is inclusive: someone who types 10 August means "up to and
 * including the 10th". A bare `new Date("2026-08-10")` is midnight UTC, which
 * would silently drop that whole day — a small enough slice to go unnoticed
 * and land as "why is that email missing" much later.
 */
function parseRange(
  input: DateRangeInput
): { start: Date; end: Date } | { error: string } {
  const start = new Date(
    input.start.length === 10 ? `${input.start}T00:00:00` : input.start
  );
  const end = new Date(
    input.end.length === 10 ? `${input.end}T23:59:59.999` : input.end
  );
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "Pick a valid date range" };
  }
  if (start >= end) {
    return { error: "The start date must come before the end date" };
  }
  return { start, end };
}

/**
 * Spend for a run of this shape, in USD, from this user's own ledger.
 *
 * Measured, not guessed. Two earlier versions were wrong in the same
 * direction, and low estimates are the ones that do harm — they invite a
 * confirmation on a number that is not true:
 *
 *  - $0.00025 per email, counting classification only and converting
 *    characters to tokens at an English-like ratio. Real mail here measures
 *    ~288 input tokens per classified email, not the ~89 that ratio predicted,
 *    because CJK text costs far more per character. It under-reported a real
 *    run threefold.
 *  - One blended $/email from the month's ledger. The blend is learned mostly
 *    from Updates, which extract almost nothing, and was then used to price a
 *    Reset, which re-extracts every job-related email in the window. That
 *    undershot a full Reset by 10–15%.
 *
 * Hence two rates and two counts: emails to judge, and of those, emails that
 * will be extracted. Callers know their own shape — a Reset re-extracts what
 * is already job-related in the window; a re-judge extracts only the few
 * verdicts that flip.
 */
async function estimateCost(
  userId: string,
  emails: number,
  extractions: number
): Promise<number> {
  return estimateSpend(await getMeasuredRates(userId), emails, extractions);
}

/**
 * What a Reset would pull in, before it pulls anything.
 *
 * One free Gmail call, no model tokens. This is what earns the right to lift
 * the 4,000-message cap afterwards: the cap guards against a surprise bill,
 * and a number shown on screen before the user commits is the opposite of a
 * surprise.
 */
export async function previewResetAction(
  input: DateRangeInput
): Promise<
  ActionResult<{ count: number; estimatedCost: number; overCap: boolean }>
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const range = parseRange(input);
  if ("error" in range) return { ok: false, error: range.error };

  try {
    const [count, jobRelated] = await Promise.all([
      countMessagesInRange(user.id, range.start, range.end),
      // A Reset judges everything again and extracts whatever comes back
      // job-related. How many are job-related in that window today is the
      // closest thing to a measurement of that.
      prisma.email.count({
        where: {
          userId: user.id,
          isJobRelated: true,
          internalDate: { gte: range.start, lte: range.end },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        count,
        estimatedCost: await estimateCost(user.id, count, jobRelated),
        overCap: count > SYNC_CAP,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not reach Gmail: ${error.message.slice(0, 200)}`
          : "Could not reach Gmail",
    };
  }
}

/**
 * Wipe and rebuild for the chosen window. Destructive by design — see runReset.
 */
export async function resetAction(
  input: DateRangeInput
): Promise<ActionResult<{ started: true }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const state = await prisma.syncState.findUnique({
    where: { userId: user.id },
    select: { status: true },
  });
  if (state?.status === "running") {
    return { ok: false, error: "A sync is already running — wait for it to finish" };
  }

  const range = parseRange(input);
  if ("error" in range) return { ok: false, error: range.error };

  // Fire and forget; the sync-status endpoint reports progress.
  runReset(user.id, range.start, range.end).catch((err) => {
    console.error("Reset failed:", err);
  });

  revalidatePath("/");
  return { ok: true, data: { started: true } };
}

/**
 * Drop cards the extraction should never have created.
 *
 * Recall is deliberately generous — the Gmail query filters almost nothing, so
 * the classifier sees promotions too, and occasionally one lands as a card: a
 * union recruitment mail sent on a gig platform's behalf reads a lot like
 * correspondence about casual work the user actually does. That is the price
 * of not filtering before the model looks, and it is the right trade, but it
 * needs somewhere to be undone.
 *
 * Only the card goes. The verdict on the email is left alone: overwriting it
 * would put a human correction into a field that Reset rewrites from scratch,
 * so it would look durable and quietly not be. A deleted card stays gone until
 * the next Reset, which is honest about what this can promise.
 */
export async function deleteApplicationsAction(
  ids: string[]
): Promise<ActionResult<{ deleted: number }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (ids.length === 0) return { ok: true, data: { deleted: 0 } };

  const owned = await prisma.application.findMany({
    where: { id: { in: ids }, userId: user.id },
    select: { id: true },
  });
  if (owned.length === 0) return { ok: false, error: "Not found" };

  const ownedIds = owned.map((a) => a.id);
  await prisma.email.updateMany({
    where: { userId: user.id, applicationId: { in: ownedIds } },
    data: { applicationId: null },
  });
  const result = await prisma.application.deleteMany({
    where: { id: { in: ownedIds }, userId: user.id },
  });

  revalidatePath("/");
  return { ok: true, data: { deleted: result.count } };
}

/**
 * Record that two company names are the same employer.
 *
 * Normalisation already folds brackets and legal suffixes, but
 * "PricewaterhouseCoopers" vs "PwC" is an abbreviation and "Meta" vs
 * "Facebook" vs "脸书" spans a rename and a translation. No rule general enough to
 * catch those is safe: the same rule merges Google with Google Cloud for the
 * next person. The judgement needs knowledge the system does not have, so the
 * user supplies it — once per pair, a handful of times in a search.
 *
 * Stored per user, never in code. An alias table shipped in the repository
 * would make one person's employers everybody's defaults.
 */
export async function mergeCompaniesAction(input: {
  aliasNormalized: string;
  canonicalNormalized: string;
  canonicalLabel: string;
}): Promise<ActionResult<{ merged: true }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (input.aliasNormalized === input.canonicalNormalized) {
    return { ok: false, error: "A company cannot be merged into itself" };
  }

  await prisma.companyAlias.upsert({
    where: {
      userId_aliasNormalized: {
        userId: user.id,
        aliasNormalized: input.aliasNormalized,
      },
    },
    create: {
      userId: user.id,
      aliasNormalized: input.aliasNormalized,
      canonicalNormalized: input.canonicalNormalized,
      canonicalLabel: input.canonicalLabel,
    },
    update: {
      canonicalNormalized: input.canonicalNormalized,
      canonicalLabel: input.canonicalLabel,
    },
  });

  // Anything already pointing at the alias follows it, so a chain like
  // 脸书 → Facebook → Meta collapses instead of leaving a dangling hop.
  await prisma.companyAlias.updateMany({
    where: { userId: user.id, canonicalNormalized: input.aliasNormalized },
    data: {
      canonicalNormalized: input.canonicalNormalized,
      canonicalLabel: input.canonicalLabel,
    },
  });

  revalidatePath("/");
  return { ok: true, data: { merged: true } };
}

/** Undo a merge. The cards separate again on the next render. */
export async function unmergeCompanyAction(
  aliasNormalized: string
): Promise<ActionResult<{ removed: number }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const result = await prisma.companyAlias.deleteMany({
    where: { userId: user.id, aliasNormalized },
  });
  revalidatePath("/");
  return { ok: true, data: { removed: result.count } };
}

/** Spend so far, read from the ledger rather than predicted. */
export async function getUsageAction(): Promise<
  ActionResult<{
    monthCost: number;
    monthCalls: number;
    monthEmails: number;
    costPerEmail: number | null;
    lastRun: { at: string; cost: number; emails: number } | null;
  }>
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const s = await getUsageSummary(user.id);
  return {
    ok: true,
    data: {
      monthCost: s.monthCost,
      monthCalls: s.monthCalls,
      monthEmails: s.monthEmails,
      costPerEmail: s.costPerEmail,
      lastRun: s.lastRun
        ? {
            at: s.lastRun.at.toISOString(),
            cost: s.lastRun.cost,
            emails: s.lastRun.emails,
          }
        : null,
    },
  };
}

/**
 * What a re-judge would actually cost, without spending anything.
 *
 * Shown before the button is pressed because the two numbers together are the
 * argument for the whole design: the gap between "ruled out" and "worth
 * asking again" is where the savings live, and a user who cannot see that gap
 * has no reason to trust that the cheap path is not just cutting corners.
 */
export async function previewRejudgeAction(
  input?: DateRangeInput
): Promise<
  ActionResult<{ queued: number; skipped: number; estimatedCost: number }>
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  let range: { start: Date; end: Date } | undefined;
  if (input) {
    const parsed = parseRange(input);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    range = parsed;
  }

  const { currentHash } = await countStaleVerdicts(user.id);
  const stale = {
    userId: user.id,
    isJobRelated: false,
    OR: [{ profileHash: null }, { profileHash: { not: currentHash } }],
    ...(range ? { internalDate: { gte: range.start, lte: range.end } } : {}),
  };

  const [queued, skipped, judged, positives] = await Promise.all([
    prisma.email.count({
      where: { ...stale, emailType: { not: BULK_AD_TYPE } },
    }),
    prisma.email.count({ where: { ...stale, emailType: BULK_AD_TYPE } }),
    prisma.email.count({ where: { userId: user.id, isJobRelated: { not: null } } }),
    prisma.email.count({ where: { userId: user.id, isJobRelated: true } }),
  ]);

  // Only the verdicts that flip get extracted, and nothing measures how often
  // that happens — these emails were already rejected once, so it is rarer
  // than in the mailbox at large. The mailbox's own share of job-related mail
  // therefore stands in as a ceiling, which keeps the estimate on the high
  // side rather than the harmful one.
  const flips = judged > 0 ? Math.ceil((queued * positives) / judged) : 0;

  return {
    ok: true,
    data: { queued, skipped, estimatedCost: await estimateCost(user.id, queued, flips) },
  };
}

export async function analyzeJdAction(input: {
  jdText: string;
  applicationId?: string;
}): Promise<ActionResult<{ analysisId: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const jdText = input.jdText.trim();
  if (jdText.length < 30) {
    return { ok: false, error: "That JD looks too short — paste the full posting" };
  }

  if (input.applicationId) {
    const owned = await prisma.application.findFirst({
      where: { id: input.applicationId, userId: user.id },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Application not found" };
  }

  try {
    const analysis = await analyzeJdWithNanobot(user.id, jdText);

    const row = await prisma.jdAnalysis.create({
      data: {
        userId: user.id,
        applicationId: input.applicationId ?? null,
        company: analysis.company,
        role: analysis.role,
        jdText,
        rating: analysis.rating,
        matchScore: analysis.matchScore,
        verdict: analysis.verdict,
        analysisJson: JSON.stringify(analysis),
        model: NANOBOT_MODEL,
      },
    });

    revalidatePath("/analyze");
    revalidatePath("/");
    if (input.applicationId) {
      revalidatePath(`/applications/${input.applicationId}`);
    }
    return { ok: true, data: { analysisId: row.id } };
  } catch (error) {
    if (error instanceof NoCvError) {
      return {
        ok: false,
        code: "NO_CV",
        error: "No CV in nanobot memory yet — add one on the CV page first",
      };
    }
    return {
      ok: false,
      error: describe(error),
      code: error instanceof NanobotError ? "OFFLINE" : undefined,
    };
  }
}

/**
 * Persist hand-edits to an analysis. The agent's output is a starting point,
 * not a verdict — the user knows things about the role that the JD does not say.
 */
export async function updateAnalysisAction(
  id: string,
  analysis: JdAnalysis
): Promise<ActionResult<null>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const parsed = JdAnalysisSchema.safeParse(analysis);
  if (!parsed.success) {
    return { ok: false, error: "Edited analysis is not in the expected shape" };
  }

  const owned = await prisma.jdAnalysis.findFirst({
    where: { id, userId: user.id },
    select: { id: true, applicationId: true },
  });
  if (!owned) return { ok: false, error: "Not found" };

  await prisma.jdAnalysis.update({
    where: { id },
    data: {
      company: parsed.data.company,
      role: parsed.data.role,
      rating: parsed.data.rating,
      matchScore: parsed.data.matchScore,
      verdict: parsed.data.verdict,
      analysisJson: JSON.stringify(parsed.data),
      editedAt: new Date(),
    },
  });

  revalidatePath("/analyze");
  revalidatePath("/");
  if (owned.applicationId) revalidatePath(`/applications/${owned.applicationId}`);
  return { ok: true, data: null };
}

export async function deleteAnalysisAction(
  id: string
): Promise<ActionResult<null>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const analysis = await prisma.jdAnalysis.findFirst({
    where: { id, userId: user.id },
    select: { applicationId: true },
  });
  if (!analysis) return { ok: false, error: "Not found" };

  await prisma.jdAnalysis.delete({ where: { id } });
  revalidatePath("/analyze");
  revalidatePath("/");
  if (analysis.applicationId) {
    revalidatePath(`/applications/${analysis.applicationId}`);
  }
  return { ok: true, data: null };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

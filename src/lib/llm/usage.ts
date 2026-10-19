import { prisma } from "@/lib/db";

/**
 * Published per-million-token rates, checked 2026-09-02 against Anthropic's
 * pricing page. Re-check when adding a model; a stale rate here silently
 * mis-reports every row written after the change.
 *
 * Cache multipliers are the same for every model: a write costs 1.25x the
 * input rate, a read 0.1x. That 10x discount on reads is why the classifier
 * puts its stable prompt behind a cache breakpoint — see classify.ts.
 */
const RATES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** The four counters every Messages API response carries. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Exact cost of one call, in USD.
 *
 * `input_tokens` excludes cached tokens — the API reports the three input
 * buckets separately, so they are added rather than substituted. Treating
 * `input_tokens` as the whole input would under-count a cached call.
 */
export function priceCall(model: string, usage: TokenUsage): number {
  const rate = RATES[model];
  if (!rate) return 0;

  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  const inputCost =
    (usage.input_tokens +
      cacheWrite * CACHE_WRITE_MULTIPLIER +
      cacheRead * CACHE_READ_MULTIPLIER) *
    (rate.input / 1_000_000);
  const outputCost = usage.output_tokens * (rate.output / 1_000_000);

  return inputCost + outputCost;
}

/**
 * Record one call. Never throws.
 *
 * Accounting must not be able to fail the work it is measuring: a dropped row
 * costs a slightly low total, whereas an exception here would abort a sync
 * mid-run and lose the emails it was classifying. The console.error is the
 * signal that the ledger has a hole in it.
 */
export async function recordUsage(input: {
  userId: string;
  operation: "classify" | "extract" | "cv_parse" | "cv_update" | "prep";
  model: string;
  items?: number;
  usage: TokenUsage;
}): Promise<void> {
  try {
    await prisma.llmUsage.create({
      data: {
        userId: input.userId,
        operation: input.operation,
        model: input.model,
        items: input.items ?? 1,
        inputTokens: input.usage.input_tokens,
        outputTokens: input.usage.output_tokens,
        cacheReadTokens: input.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: input.usage.cache_creation_input_tokens ?? 0,
        costUsd: priceCall(input.model, input.usage),
      },
    });
  } catch (error) {
    console.error("Failed to record LLM usage:", error);
  }
}

/**
 * What one email costs to put through each stage, in USD.
 *
 * Two prices, not one. Every email is classified; only the ones that turn out
 * to be job-related are extracted, on a dearer model and carrying the whole
 * message body — about ten times the price. A single blended $/email hides
 * that, and hides it in the worst way: the blend is learned mostly from
 * Updates, where almost nothing is extracted, and then used to price a Reset,
 * which re-extracts every job-related email in the window. Measured here on
 * 2026-09-19 the blend undershot a full Reset by 10–15%.
 */
export interface MeasuredRates {
  classify: number;
  extract: number;
}

// Measured with messages.countTokens on this project's own mail. Used until
// the ledger holds enough of this user's history to speak for their inbox —
// a mailbox of short English notifications and one full of long Chinese
// threads differ several-fold per email. The margin errs high, because an
// estimate that undershoots is the one that causes harm.
const FALLBACK_CLASSIFY = 0.0005;
const FALLBACK_EXTRACT = 0.0041;
const FALLBACK_MARGIN = 1.25;
const ENOUGH_CLASSIFIED = 200;
const ENOUGH_EXTRACTED = 20;

export async function getMeasuredRates(userId: string): Promise<MeasuredRates> {
  const [classify, extract] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { userId, operation: "classify" },
      _sum: { costUsd: true, items: true },
    }),
    prisma.llmUsage.aggregate({
      where: { userId, operation: "extract" },
      _sum: { costUsd: true, items: true },
    }),
  ]);

  const rate = (
    sum: { costUsd: number | null; items: number | null },
    enough: number,
    fallback: number
  ) => {
    const items = sum.items ?? 0;
    const cost = sum.costUsd ?? 0;
    return items >= enough && cost > 0
      ? cost / items
      : fallback * FALLBACK_MARGIN;
  };

  return {
    classify: rate(classify._sum, ENOUGH_CLASSIFIED, FALLBACK_CLASSIFY),
    extract: rate(extract._sum, ENOUGH_EXTRACTED, FALLBACK_EXTRACT),
  };
}

/** What a run of this shape will cost, to the cent. */
export function estimateSpend(
  rates: MeasuredRates,
  emails: number,
  extractions: number
): number {
  return (
    Math.round((emails * rates.classify + extractions * rates.extract) * 100) /
    100
  );
}

export interface UsageSummary {
  monthCost: number;
  monthCalls: number;
  monthEmails: number;
  /** Measured $/email, or null until there is enough history to mean anything. */
  costPerEmail: number | null;
  lastRun: { at: Date; cost: number; emails: number } | null;
}

/**
 * What has actually been spent, from the ledger rather than from a formula.
 */
export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const month = await prisma.llmUsage.aggregate({
    where: { userId, at: { gte: monthStart } },
    _sum: { costUsd: true },
    _count: true,
  });

  // How many emails were processed — counted on the classification calls only,
  // because every email is classified exactly once while a job-related one is
  // also extracted. Summing `items` across operations counted those twice and
  // reported "142 emails" for a run that judged 141.
  const monthJudged = await prisma.llmUsage.aggregate({
    where: { userId, at: { gte: monthStart }, operation: "classify" },
    _sum: { items: true },
  });

  // A "run" is a burst of calls: Reset fires hundreds over several minutes,
  // and reporting only the last call would show a fraction of a cent for what
  // was actually a dollar. Anything within ten minutes of the newest call is
  // treated as part of the same burst.
  const newest = await prisma.llmUsage.findFirst({
    where: { userId },
    orderBy: { at: "desc" },
    select: { at: true },
  });

  let lastRun: UsageSummary["lastRun"] = null;
  if (newest) {
    const since = new Date(newest.at.getTime() - 10 * 60 * 1000);
    const [run, judged] = await Promise.all([
      prisma.llmUsage.aggregate({
        where: { userId, at: { gte: since } },
        _sum: { costUsd: true },
      }),
      prisma.llmUsage.aggregate({
        where: { userId, at: { gte: since }, operation: "classify" },
        _sum: { items: true },
      }),
    ]);
    lastRun = {
      at: newest.at,
      cost: run._sum.costUsd ?? 0,
      emails: judged._sum.items ?? 0,
    };
  }

  const monthCost = month._sum.costUsd ?? 0;
  const monthEmails = monthJudged._sum.items ?? 0;

  return {
    monthCost,
    monthCalls: month._count,
    monthEmails,
    // All-in spend divided by emails judged. Below a few hundred emails the
    // average says nothing useful, so it is withheld rather than shown wrong.
    //
    // Known limit: this blends whatever the month happened to contain. A month
    // of Updates barely extracts anything, so using this rate to price a Reset
    // — which re-extracts every job-related email — undershoots. The fix is to
    // measure the classification and extraction rates separately; see
    // CONTEXT-SNAPSHOT §8.4.
    costPerEmail: monthEmails >= 200 ? monthCost / monthEmails : null,
    lastRun,
  };
}

import { prisma } from "@/lib/db";
import {
  getFreshAccessToken,
  listMessages,
  getMessage,
  ReauthRequiredError,
} from "./client";
import { extractPlainText, extractFromAddress, extractHeader } from "./mime";
import { classifyEmails } from "@/lib/llm/classify";
import { buildClassifierProfile } from "@/lib/cv/profile";
import { extractEmails } from "@/lib/llm/extract";
import { ExtractionResultSchema } from "@/lib/llm/schemas";
import {
  computeMergeActions,
  type EmailWithExtraction,
  type ExistingApplication,
  type MergeAction,
} from "@/lib/applications/merge";

// How far back to look on a first sync. A role that has not replied in three
// months is a silent rejection, so widening this mostly buys noise. Note it
// only applies to the FIRST sync — after that buildQuery uses the watermark,
// so changing this number alone will not re-scan history.
const LOOKBACK_WINDOW = "newer_than:90d";

// Hand off almost everything and let the classifier judge.
//
// This used to carry a whitelist of subject keywords and sender domains. That
// was cheap but it decided what counted as a job email *before* any model saw
// it: on a real inbox it passed 601 of 1466 messages, and a rejection titled
// "Update on your candidacy" from a company's own domain never reached the
// classifier at all. Worse for a tool other people run — the list encoded one
// person's industry, language and job boards.
//
// The only filters left are structural: Google Chat transcripts are not email,
// and spam/trash are excluded by Gmail's own search defaults (add `in:anywhere`
// to include them). Promotions and Social are deliberately NOT excluded — ATS
// and job-board mail lands there constantly.
const GMAIL_SEARCH_QUERY = [LOOKBACK_WINDOW, "-in:chat"].join(" ");

// Ceiling on a single sync, so a first run against a huge mailbox cannot turn
// into a surprise bill. Newest mail is kept when the cap bites.
const MAX_EMAILS_PER_SYNC = Number(process.env.SYNC_MAX_EMAILS ?? 4000);

const FETCH_CONCURRENCY = 5;

export interface SyncOptions {
  /**
   * Fetch this explicit window instead of continuing from the watermark.
   * Reset uses it; Update never does.
   */
  range?: { start: Date; end: Date };
  /**
   * Skip MAX_EMAILS_PER_SYNC. The cap exists to stop a SURPRISE bill — once
   * the user has been shown the message count and the estimated cost and has
   * confirmed, there is no surprise left to guard against, and truncating
   * would silently drop the older half of a window they explicitly asked for.
   */
  unlimited?: boolean;
  /** Recorded so the dashboard can say which button produced the timestamp. */
  action?: "update" | "rejudge" | "reset";
}

export async function runSync(
  userId: string,
  options: SyncOptions = {}
): Promise<void> {
  const syncState = await prisma.syncState.upsert({
    where: { userId },
    create: { userId, status: "running", progressPhase: "fetching" },
    update: {
      status: "running",
      progressPhase: "fetching",
      progressFetched: 0,
      progressTotal: 0,
      lastError: null,
    },
  });

  // A range run has already fetched everything up to range.end, so that — not
  // "now" — is where the next incremental run must resume. Stamping "now"
  // instead would skip every message between range.end and this moment, and
  // the Update that follows a Reset would silently find nothing.
  const nextWatermark = options.range?.end ?? new Date();

  try {
    const accessToken = await getFreshAccessToken(userId);

    const query = options.range
      ? buildRangeQuery(options.range.start, options.range.end)
      : buildQuery(syncState.lastSyncedAt, syncState.windowStart);
    const messageIds = await fetchAllMessageIds(accessToken, query);

    const existingGmailIds = new Set(
      (
        await prisma.email.findMany({
          where: { userId, gmailId: { in: messageIds.map((m) => m.id) } },
          select: { gmailId: true },
        })
      ).map((e) => e.gmailId)
    );

    const candidates = messageIds.filter((m) => !existingGmailIds.has(m.id));

    // Gmail lists newest first, so trimming the tail keeps the most recent
    // mail — the part a job search actually cares about.
    //
    // Note the old advice here ("sync again to continue") was wrong: the
    // watermark advances at the end of a run, so anything trimmed off the tail
    // is unreachable from a later Update and only a ranged Reset can recover
    // it. That is why a confirmed Reset runs unlimited instead.
    const newMessages = options.unlimited
      ? candidates
      : candidates.slice(0, MAX_EMAILS_PER_SYNC);
    if (candidates.length > newMessages.length) {
      console.warn(
        `Sync capped at ${MAX_EMAILS_PER_SYNC} of ${candidates.length} new messages. ` +
          `Raise SYNC_MAX_EMAILS, or use Reset with an explicit range to take them all.`
      );
    }

    await prisma.syncState.update({
      where: { userId },
      data: { progressTotal: newMessages.length },
    });

    if (newMessages.length === 0) {
      // No new mail, but earlier emails may still be unclassified or
      // unextracted if a previous run failed partway through. Let the
      // pipeline pick those up instead of returning early and stranding them.
      await classifyAndExtract(userId);

      await prisma.syncState.update({
        where: { userId },
        data: {
          status: "idle",
          progressPhase: null,
          lastSyncedAt: nextWatermark,
          ...(options.action ? { lastAction: options.action } : {}),
        },
      });
      return;
    }

    const failed = await fetchAndStoreEmails(userId, accessToken, newMessages);

    await classifyAndExtract(userId);

    if (failed > 0) {
      // Listed but never stored. Moving the watermark past them would put
      // them behind every later Update's query — lost from the window with the
      // run reporting success. So the run says what it missed, and the
      // watermark stays where the next Update lists them again: unchanged for
      // an Update, the start of the range for a Reset. Stored mail is skipped
      // by id on that pass, so the retry costs one listing and the missed
      // messages, nothing more.
      await prisma.syncState.update({
        where: { userId },
        data: {
          status: "error",
          progressPhase: null,
          lastError:
            `${failed} of ${newMessages.length} new emails could not be downloaded ` +
            `from Gmail (usually its per-minute limit). The rest were processed — ` +
            `click Update to fetch the missing ones.`,
          ...(options.range ? { lastSyncedAt: options.range.start } : {}),
          ...(options.action ? { lastAction: options.action } : {}),
        },
      });
      return;
    }

    await prisma.syncState.update({
      where: { userId },
      data: {
        status: "idle",
        progressPhase: null,
        lastSyncedAt: nextWatermark,
        ...(options.action ? { lastAction: options.action } : {}),
      },
    });
  } catch (error) {
    const message =
      error instanceof ReauthRequiredError
        ? "reauth"
        : error instanceof Error
          ? error.message.slice(0, 500)
          : "Unknown error";

    await prisma.syncState.update({
      where: { userId },
      data: { status: "error", lastError: message, progressPhase: null },
    });
  }
}

/**
 * The incremental query: from the watermark, less a day of overlap for mail
 * that arrives out of order — but never from before the tracking window,
 * because the database holds the window and only the window. The floor
 * matters when a Reset could not download everything and parks the watermark
 * at the start of its range: the overlap would otherwise reach a day past it.
 */
export function buildQuery(
  lastSyncedAt: Date | null,
  windowStart: Date | null = null
): string {
  if (!lastSyncedAt) return GMAIL_SEARCH_QUERY;

  let from = lastSyncedAt.getTime() - 86_400_000;
  if (windowStart) from = Math.max(from, windowStart.getTime());
  return GMAIL_SEARCH_QUERY.replace(
    LOOKBACK_WINDOW,
    `after:${Math.floor(from / 1000)}`
  );
}

/**
 * An explicit window, for Reset.
 *
 * Gmail search has no 90-day limit — LOOKBACK_WINDOW is a product choice about
 * a sensible FIRST sync, not a ceiling. A job hunt runs longer than a quarter,
 * so the user picks the start date and this reaches as far back as they ask.
 */
export function buildRangeQuery(start: Date, end: Date): string {
  const after = Math.floor(start.getTime() / 1000);
  const before = Math.floor(end.getTime() / 1000);
  return `after:${after} before:${before} -in:chat`;
}

/**
 * How many messages Gmail holds for a window, without downloading any.
 *
 * Free — listing returns ids only, and no model ever sees them — which is what
 * lets Reset show "3,180 emails, about $0.79" BEFORE spending anything.
 *
 * It pages through the whole result rather than reading `resultSizeEstimate`,
 * which was the first attempt: that field describes the page in hand, not the
 * query, and returned an identical 201 for a three-month window and a
 * twelve-month one. A cost preview that does not move with the range is worse
 * than no preview, because it invites a confirmation based on a wrong number.
 */
export async function countMessagesInRange(
  userId: string,
  start: Date,
  end: Date
): Promise<number> {
  const accessToken = await getFreshAccessToken(userId);
  const ids = await fetchAllMessageIds(accessToken, buildRangeQuery(start, end));
  return ids.length;
}

async function fetchAllMessageIds(
  accessToken: string,
  query: string
): Promise<{ id: string; threadId: string }[]> {
  const allMessages: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  do {
    const response = await listMessages(accessToken, query, pageToken);
    if (response.messages) {
      allMessages.push(...response.messages);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  return allMessages;
}

/** Returns how many listed messages could not be downloaded, after retries. */
async function fetchAndStoreEmails(
  userId: string,
  accessToken: string,
  messages: { id: string; threadId: string }[]
): Promise<number> {
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i += FETCH_CONCURRENCY) {
    const batch = messages.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((msg) => getMessage(accessToken, msg.id))
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Failed to fetch message:", result.reason);
        failed++;
        continue;
      }

      const msg = result.value;
      const bodyText = extractPlainText(msg.payload);
      const from = extractFromAddress(msg.payload);
      const subject = extractHeader(msg.payload, "Subject") ?? "(no subject)";

      await prisma.email.upsert({
        where: { userId_gmailId: { userId, gmailId: msg.id } },
        create: {
          userId,
          gmailId: msg.id,
          threadId: msg.threadId,
          fromAddress: from,
          subject,
          snippet: msg.snippet,
          internalDate: new Date(parseInt(msg.internalDate, 10)),
          bodyText: bodyText ?? msg.snippet,
        },
        update: {},
      });
    }

    fetched += batch.length;
    await prisma.syncState.update({
      where: { userId },
      data: { progressFetched: Math.min(fetched, messages.length) },
    });
  }

  return failed;
}

async function classifyAndExtract(userId: string): Promise<void> {
  await prisma.syncState.update({
    where: { userId },
    data: { progressPhase: "classifying" },
  });

  // Unchanged on purpose: a BULK_AD_TYPE email still carries a real verdict
  // (isJobRelated = false), so it never reaches this queue anyway. The stamp
  // does its work one level up, in the re-judge reset — that is the only place
  // that would otherwise hand these back to the model. Filtering here as well
  // would only invite the idea that a stamp somehow suppresses an unjudged
  // email, which is exactly the "buried without being asked" state this
  // project keeps refusing to create.
  const unclassifiedEmails = await prisma.email.findMany({
    where: { userId, isJobRelated: null },
    select: { id: true, gmailId: true, fromAddress: true, subject: true, snippet: true },
  });

  if (unclassifiedEmails.length > 0) {
    const classificationInput = unclassifiedEmails.map((e) => ({
      id: e.gmailId,
      from: e.fromAddress,
      subject: e.subject,
      snippet: e.snippet,
    }));

    const profile = await buildClassifierProfile(userId);
    const classifications = await classifyEmails(
      classificationInput,
      profile.text,
      userId
    );

    for (const result of classifications) {
      const email = unclassifiedEmails.find((e) => e.gmailId === result.id);
      if (email) {
        await prisma.email.update({
          where: { id: email.id },
          data: {
            isJobRelated: result.isJobRelated,
            emailType: result.emailType,
            classifiedAt: new Date(),
            profileHash: profile.hash,
          },
        });
      }
    }
  }

  await prisma.syncState.update({
    where: { userId },
    data: { progressPhase: "extracting" },
  });

  const jobRelatedEmails = await prisma.email.findMany({
    where: { userId, isJobRelated: true, extractedAt: null },
    select: {
      id: true,
      gmailId: true,
      fromAddress: true,
      subject: true,
      bodyText: true,
      internalDate: true,
    },
  });

  if (jobRelatedEmails.length > 0) {
    const extractionInput = jobRelatedEmails.map((e) => ({
      id: e.gmailId,
      from: e.fromAddress,
      subject: e.subject,
      bodyText: e.bodyText ?? e.subject,
    }));

    const extractions = await extractEmails(extractionInput, userId);

    const emailsWithExtractions: EmailWithExtraction[] = [];

    for (const email of jobRelatedEmails) {
      const extraction = extractions.get(email.gmailId);
      if (extraction) {
        await prisma.email.update({
          where: { id: email.id },
          data: {
            extractedAt: new Date(),
            extractionJson: JSON.stringify(extraction),
          },
        });

        emailsWithExtractions.push({
          id: email.id,
          gmailId: email.gmailId,
          internalDate: email.internalDate,
          extractionResult: extraction,
        });
      }
    }

    if (emailsWithExtractions.length > 0) {
      const existingApps = await prisma.application.findMany({
        where: { userId },
        select: {
          id: true,
          companyNormalized: true,
          roleNormalized: true,
          status: true,
          statusIsManual: true,
        },
      });

      await applyMergeActions(
        userId,
        computeMergeActions(
          emailsWithExtractions,
          existingApps as ExistingApplication[]
        )
      );
    }
  }
}

/**
 * Throw the current picture away and rebuild it for a window the user chose.
 *
 * This is the floor the other two buttons stand on. Update and Re-judge both
 * economise — they skip what they have already paid to decide — so every
 * shortcut they take needs somewhere to be undone. Reset is that place, and it
 * therefore takes NO shortcuts: it drops the cards, drops mail outside the
 * window, clears every verdict AND every bulk-mail stamp inside it, and pays
 * to judge the whole window again from scratch.
 *
 * Clearing the stamps is the part that matters. A stamp is the classifier's
 * own call, and a rejection wrongly stamped as a promotion would otherwise be
 * invisible forever. Making one operation that reconsiders everything is what
 * keeps the cheap paths safe to use.
 *
 * Afterwards the invariant holds: the emails in the database are exactly the
 * emails in the window.
 */
export async function runReset(
  userId: string,
  start: Date,
  end: Date
): Promise<void> {
  await prisma.email.updateMany({
    where: { userId },
    data: { applicationId: null },
  });
  await prisma.application.deleteMany({ where: { userId } });

  await prisma.email.deleteMany({
    where: { userId, OR: [{ internalDate: { lt: start } }, { internalDate: { gt: end } }] },
  });

  await prisma.email.updateMany({
    where: { userId },
    data: {
      isJobRelated: null,
      emailType: null,
      classifiedAt: null,
      profileHash: null,
      extractedAt: null,
      extractionJson: null,
    },
  });

  // Recorded before the fetch, because the wipe above has already made it
  // true: whatever happens next, this is the window the database now holds.
  await prisma.syncState.upsert({
    where: { userId },
    create: { userId, windowStart: start, status: "idle" },
    update: { windowStart: start },
  });

  await runSync(userId, {
    range: { start, end },
    unlimited: true,
    action: "reset",
  });
}

/**
 * Rebuild every application from the extractions already stored on emails.
 *
 * Makes no LLM calls — run it after changing the merge heuristics to
 * re-derive the cards from data you have already paid to extract. Manually
 * set statuses are not preserved, because the applications themselves are
 * recreated.
 */
export async function rebuildApplications(userId: string): Promise<void> {
  const emails = await prisma.email.findMany({
    where: { userId, isJobRelated: true, extractionJson: { not: null } },
    select: { id: true, gmailId: true, internalDate: true, extractionJson: true },
  });

  const emailsWithExtractions: EmailWithExtraction[] = [];
  for (const email of emails) {
    const parsed = ExtractionResultSchema.safeParse(
      JSON.parse(email.extractionJson!)
    );
    if (!parsed.success) continue;
    emailsWithExtractions.push({
      id: email.id,
      gmailId: email.gmailId,
      internalDate: email.internalDate,
      extractionResult: parsed.data,
    });
  }

  await prisma.email.updateMany({
    where: { userId },
    data: { applicationId: null },
  });
  await prisma.application.deleteMany({ where: { userId } });

  await applyMergeActions(userId, computeMergeActions(emailsWithExtractions, []));
}

async function applyMergeActions(
  userId: string,
  mergeActions: MergeAction[]
): Promise<void> {
  // computeMergeActions refers to applications created earlier in this
  // same batch by a placeholder id ("pending_<emailId>"), because the real
  // row does not exist yet at that point. Translate those placeholders to
  // real database ids as we go — otherwise the follow-up update targets a
  // row that was never inserted and the whole sync aborts.
  const pendingToRealId = new Map<string, string>();

  for (const action of mergeActions) {
    try {
      if (action.type === "create") {
        const app = await prisma.application.create({
          data: {
            userId,
            company: action.company,
            companyNormalized: action.companyNormalized,
            role: action.role,
            roleNormalized: action.roleNormalized,
            status: action.newStatus ?? "APPLIED",
            appliedDate: action.emailDate,
            lastEmailDate: action.emailDate,
          },
        });

        if (action.applicationId) {
          pendingToRealId.set(action.applicationId, app.id);
        }

        await prisma.email.update({
          where: { id: action.emailId },
          data: { applicationId: app.id },
        });
      } else if (action.type === "update" && action.applicationId) {
        const applicationId =
          pendingToRealId.get(action.applicationId) ?? action.applicationId;

        await prisma.application.update({
          where: { id: applicationId },
          data: {
            ...(action.newStatus ? { status: action.newStatus } : {}),
            lastEmailDate: action.emailDate,
          },
        });

        await prisma.email.update({
          where: { id: action.emailId },
          data: { applicationId },
        });
      }
    } catch (err) {
      // A single problematic email should not abort the entire sync.
      console.error(
        `Merge action failed (${action.type}, company="${action.company}"):`,
        err
      );
    }
  }
}

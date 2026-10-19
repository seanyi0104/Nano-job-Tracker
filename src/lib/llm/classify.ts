import { anthropic, CLASSIFY_MODEL } from "./anthropic";
import {
  ClassificationResultSchema,
  CLASSIFICATION_JSON_SCHEMA,
} from "./schemas";
import type { ClassificationResult } from "./schemas";
import { recordUsage } from "./usage";

/**
 * Generic triage rules. Everything specific to one person lives in the
 * caller-supplied profile block instead — hardcoding one user's job tracks
 * here is what stops this working for anybody else.
 */
const BASE_PROMPT = `You triage a job seeker's inbox. For each numbered email, decide whether it is about THIS user's own job applications or recruiting process.

A profile of the user follows in a separate block. Use it to judge what counts
as a plausible application for this person — their target roles, industries,
seniority and locations. When the profile is thin, be generous: a real
application email is worth surfacing even if it does not obviously match.

JOB-RELATED (isJobRelated: true):
- Application confirmations ("thank you for applying", "application received",
  "感谢您的投递", "简历已收到", "您的申请已提交")
- Recruiter outreach about a specific role ("I came across your profile")
- Interview invitations, scheduling, confirmations and reminders — including
  screening calls, trial shifts, group interviews, assessment centres,
  superdays, 面试邀请, 面试通知, 约面
- Online assessments and tests (HackerRank, CodeSignal, HireVue, Pymetrics,
  SHL, one-way video interview, psychometric / numerical reasoning test,
  笔试, 在线测评, 测评邀请)
- Offers and offer paperwork (录用通知, 录用意向, contract, onboarding pack)
- Rejections ("we will not be moving forward", "after careful consideration",
  很遗憾, 未能进入下一轮, 不合适)
- Staffing-agency and casual-work correspondence about the user's OWN work:
  registering or onboarding with an agency, induction bookings, shift or
  placement offers and confirmations, availability and timesheet requests tied
  to a placement they hold or applied for. These count even though they never
  say "interview" or "offer".
- Background checks, right-to-work checks and reference requests tied to a
  specific application or placement.

NOT JOB-RELATED (isJobRelated: false):
- Job alerts, digests and recommendation mail ("jobs for you", "new jobs
  matching your search", 职位订阅, 职位推荐, 为你推荐, 每日职位). These advertise
  roles the user has NOT applied to. This is the single most common false
  positive — when in doubt about a bulk mail from a job board, exclude it.
- Marketing from job boards and career platforms
- Company newsletters, blog updates, event and webinar invitations
- Class, club, or university administrative email
- Password resets and account notifications from job sites

Emails may be written in any language. Apply the same rules regardless.

For emailType, use:
- "applied" - confirmation that an application was submitted
- "recruiter_outreach" - a recruiter reaching out about a potential opportunity
- "interview" - interview or screening scheduling, confirmation or reminder
- "oa" - online assessment or test invitation
- "offer" - job offer
- "rejection" - application was rejected
- "other" - job-related but none of the above

For agency and casual work, map to the closest type above:
- registering with an agency, submitting an expression of interest, submitting
  availability, or applying for a shift -> "applied"
- trial shift, group interview, meet-and-greet, or a booked candidate phone
  call with an agency's recruitment team -> "interview"
- being selected for a placement, an induction booking, or a first roster
  confirmation -> "offer"
- being told a shift or placement went to someone else -> "rejection"
- roster, timesheet, payroll, superannuation, background-check and induction
  admin for work the user already holds -> "other" (still isJobRelated: true)

When isJobRelated is FALSE, emailType records how certain that call is, because
it decides whether the email is ever looked at again:
- "bulk_ad" - mass mail that is plainly not about this person's own
  applications: job alerts and recommendation digests, marketing and
  promotions, retail / travel / food offers, newsletters, social-network
  notification digests, market and news alerts, and account or security
  notices from services unrelated to a job search.
- "other" - everything else you rule out, INCLUDING anything you are unsure
  about, and anything sent by a real person or a real employer.

The two are not symmetrical. "bulk_ad" is permanent: that email is never
re-examined, so a genuine rejection or interview mail marked "bulk_ad" is lost
for good. "other" only costs a fraction of a cent to re-check later and loses
nothing. If there is any doubt at all, answer "other".

OUTPUT FORMAT (important):
Return ONLY a JSON object in exactly this shape. No markdown code fences, no
commentary before or after:

{"results": [{"id": "<ID copied exactly from the email's ID: line>", "isJobRelated": true, "emailType": "applied"}]}

Include exactly one entry for EVERY email in the batch, in the same order.
The "id" value must be copied character-for-character from the "ID:" line of
that email.`;

/** Used when the user has not stored a CV yet. */
export const GENERIC_PROFILE = `<user_profile>
No CV on file yet. Assume an early-career candidate applying broadly across
industries and locations, including part-time and casual work. Judge emails on
whether they are about an application or recruiting process at all, not on
whether the role fits a particular background.
</user_profile>`;

/**
 * Emails per classification call.
 *
 * Raised from 12 after measurement showed the prompt cache never engages:
 * Haiku 4.5 will not cache a prefix under 4,096 tokens and the system prompt
 * is ~1,430, so every call pays full price for the same rules. The only way to
 * send those rules fewer times is to send more emails with each one. Doubling
 * the batch halves the number of calls, and with it the repeated cost of the
 * prompt — roughly $0.17 off a full rebuild.
 *
 * Bounded by two things. Output: ~33 tokens per email, so 24 lands near 800
 * against a 2,000 ceiling. Blast radius: a batch that comes back unusable
 * leaves all of its emails unjudged. That used to be catastrophic — the old
 * fallback marked the whole batch not-job-related and buried 300 emails — but
 * a failed batch now returns nothing and the emails stay queued for the next
 * run, so a larger batch costs a retry rather than data.
 */
const BATCH_SIZE = 24;

export async function classifyEmails(
  emails: { id: string; from: string; subject: string; snippet: string }[],
  profile: string = GENERIC_PROFILE,
  userId?: string
): Promise<ClassificationResult["results"]> {
  const results: ClassificationResult["results"] = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch, profile, userId);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Pull a JSON value out of a model response.
 *
 * Handles the shapes models actually return: a plain object, a bare array,
 * output wrapped in ```json fences, and output with prose before or after.
 * The previous implementation used a greedy /\{[\s\S]*\}/ regex, which
 * silently corrupted bare arrays by stripping their outer brackets.
 */
function extractJson(text: string): unknown {
  let s = text.trim();
  s = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(s);
  } catch {
    // Fall through to a balanced-delimiter scan.
  }

  const start = s.search(/[[{]/);
  if (start === -1) return null;

  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const char = s[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/** Accept a bare array as shorthand for { results: [...] }. */
function normalizeResults(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { results: parsed };
  return parsed;
}

async function classifyBatch(
  batch: { id: string; from: string; subject: string; snippet: string }[],
  profile: string,
  userId?: string
): Promise<ClassificationResult["results"]> {
  const userContent = batch
    .map(
      (email, idx) =>
        `[${idx + 1}] ID: ${email.id}\nFrom: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`
    )
    .join("\n\n");

  // Returning nothing leaves these emails with isJobRelated = null, so the
  // next sync retries them. The old fallback marked the whole batch
  // not-job-related, which looks identical to a real verdict and buries the
  // email permanently — the worst possible outcome for a recall problem.
  const giveUp = (): ClassificationResult["results"] => [];

  try {
    const response = await anthropic.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 2000,
      // Rules first (identical for every user), profile second, so a change of
      // CV would only invalidate the second block.
      //
      // The cache_control marker below is currently INERT, and measurement is
      // the only way to know: Haiku 4.5 will not cache a prefix under 4,096
      // tokens, these two blocks come to about 1,430, and a prefix below the
      // minimum is not an error — the request succeeds and comes back with
      // cache_creation_input_tokens: 0. So every call pays full price for the
      // system prompt. The marker stays because it costs nothing and starts
      // working the moment the prompt grows or the model's minimum drops;
      // the LlmUsage ledger is what will say which.
      system: [
        { type: "text", text: BASE_PROMPT },
        {
          type: "text",
          text: profile,
          cache_control: { type: "ephemeral" },
        },
      ],
      // Guarantees the response shape, so a stray label can no longer take
      // twelve emails down with it.
      output_config: {
        format: { type: "json_schema", schema: CLASSIFICATION_JSON_SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    });

    // Recorded before parsing: the tokens were spent whether or not the reply
    // turns out to be usable, and a failed batch that costs money silently is
    // exactly the blind spot this ledger exists to close.
    if (userId) {
      await recordUsage({
        userId,
        operation: "classify",
        model: CLASSIFY_MODEL,
        items: batch.length,
        usage: response.usage,
      });
    }

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    const candidate = normalizeResults(extractJson(text));
    if (!candidate) {
      console.error(
        "Classification: no JSON found in model response. Raw output:",
        text.slice(0, 500)
      );
      return giveUp();
    }

    const parsed = ClassificationResultSchema.safeParse(candidate);
    if (!parsed.success) {
      console.error(
        "Classification: JSON did not match schema.",
        JSON.stringify(candidate).slice(0, 500)
      );
      return giveUp();
    }

    return parsed.data.results;
  } catch (error) {
    console.error("Classification batch failed:", error);
    return giveUp();
  }
}
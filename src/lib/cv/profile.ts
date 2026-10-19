import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { GENERIC_PROFILE } from "@/lib/llm/classify";
import { CvSummarySchema } from "@/lib/nanobot/schemas";
import { StructuredCvSchema } from "@/lib/nanobot/cv-schema";
import { BULK_AD_TYPE } from "@/lib/llm/schemas";

export interface ClassifierProfile {
  text: string;
  /** Changes whenever the profile text does — the staleness signal. */
  hash: string;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Build the `<user_profile>` block the email classifier is steered by.
 *
 * What counts as "a job email" is different for a new grad applying to
 * investment banks than for a senior SRE, and neither of them should have to
 * edit a prompt. The CV the user already uploaded is the only description of
 * them the product has, so it is what defines triage — which is also why the
 * CV step comes before the sync step in the UI.
 *
 * Deliberately short: this rides in the system prompt of every classification
 * batch, and a long profile costs tokens on every call while giving the model
 * more ways to over-narrow.
 */
export async function buildClassifierProfile(
  userId: string
): Promise<ClassifierProfile> {
  const cv = await prisma.cvProfile.findUnique({
    where: { userId },
    select: { summaryJson: true, structuredJson: true },
  });
  if (!cv) return { text: GENERIC_PROFILE, hash: fingerprint(GENERIC_PROFILE) };

  const lines: string[] = [];

  if (cv.structuredJson) {
    const parsed = StructuredCvSchema.safeParse(JSON.parse(cv.structuredJson));
    if (parsed.success) {
      const { basics, education, experience, skills } = parsed.data;
      if (basics.jobTarget) lines.push(`Target roles: ${basics.jobTarget}`);
      if (basics.location) lines.push(`Based in: ${basics.location}`);

      const study = education[0];
      if (study) {
        lines.push(
          `Education: ${[study.degree, study.major, study.school].filter(Boolean).join(", ")}` +
            (study.endDate ? ` (finishing ${study.endDate})` : "")
        );
      }

      const employers = experience.map((e) => e.company).filter(Boolean);
      if (employers.length) {
        lines.push(`Has worked at: ${employers.slice(0, 6).join(", ")}`);
      }

      const allSkills = [
        ...skills.languages,
        ...skills.frameworks,
        ...skills.tools,
        ...skills.other,
      ].filter(Boolean);
      if (allSkills.length) {
        lines.push(`Skills: ${allSkills.slice(0, 15).join(", ")}`);
      }
    }
  }

  if (lines.length === 0 && cv.summaryJson) {
    const parsed = CvSummarySchema.safeParse(JSON.parse(cv.summaryJson));
    if (parsed.success) {
      lines.push(parsed.data.headline);
      if (parsed.data.skills.length) {
        lines.push(`Skills: ${parsed.data.skills.slice(0, 15).join(", ")}`);
      }
    }
  }

  if (lines.length === 0) {
    return { text: GENERIC_PROFILE, hash: fingerprint(GENERIC_PROFILE) };
  }

  const text = `<user_profile>
${lines.join("\n")}

Treat any application, recruiting, assessment, interview, offer or rejection
correspondence addressed to this person as job-related, whether or not the role
matches the profile above — people apply outside their stated target, and
part-time or casual work counts. Use the profile to resolve ambiguity, not to
exclude.
</user_profile>`;

  return { text, hash: fingerprint(text) };
}

/**
 * How many past "not job-related" verdicts are worth revisiting.
 *
 * Only negatives are counted. A positive rarely flips to negative when the
 * profile widens, and re-running the ones already found costs money for no
 * new information — the misses are all on the rejected side.
 *
 * `stale` deliberately excludes bulk mail, because the banner's number has to
 * be the number the button will actually act on. Counting settled promotions
 * here would advertise 1,500 emails and then re-check 300, and a headline that
 * does not survive contact with the button teaches the user to distrust both.
 * `settled` reports them separately: same information, no false promise.
 */
export async function countStaleVerdicts(userId: string): Promise<{
  stale: number;
  settled: number;
  currentHash: string;
}> {
  const { hash } = await buildClassifierProfile(userId);
  const olderProfile = {
    userId,
    isJobRelated: false,
    OR: [{ profileHash: null }, { profileHash: { not: hash } }],
  };

  const [stale, settled] = await Promise.all([
    prisma.email.count({
      where: { ...olderProfile, emailType: { not: BULK_AD_TYPE } },
    }),
    prisma.email.count({
      where: { ...olderProfile, emailType: BULK_AD_TYPE },
    }),
  ]);
  return { stale, settled, currentHash: hash };
}

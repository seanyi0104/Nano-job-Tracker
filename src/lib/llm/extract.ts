import { anthropic, EXTRACT_MODEL } from "./anthropic";
import { ExtractionResultSchema, EXTRACTION_JSON_SCHEMA } from "./schemas";
import type { ExtractionResult } from "./schemas";
import { recordUsage } from "./usage";

const SYSTEM_PROMPT = `Extract structured data from this job-search email sent to a CS student.

Rules:
- "company" is the HIRING EMPLOYER, never the ATS platform (not Greenhouse, Lever, Workday, iCIMS, SmartRecruiters, Ashby, BambooHR, Taleo, Moka/北森 and similar). If the email is from an ATS, look for the employer name in the subject/body.
- For casual or part-time work arranged through a staffing agency, use the AGENCY as the company, since that is who the user works through. Only use a client venue instead when the email is clearly about an ongoing placement at that named venue.
- Third-party services the employer or agency merely routes the user through — background-check providers (National Crime Check), payroll and payslip systems (Xero, Employment Hero), induction and compliance portals (passtab) — are NOT the company. Name the employer or agency the check or payment is for. If that is not identifiable, use the service name and set confidence to "low".
- Emails may be written in English or Chinese. Report "company" and "role" in the language the email itself uses; do not translate them.
- "role" is the job title/position. For casual work this may be a shift or duty type such as "IT Support (Casual)" or "Function Staff". If not explicitly stated, return null.
- "emailType" must be exactly one of: "applied", "recruiter_outreach", "interview", "oa", "rejection", "offer", "other". Use "interview" for any interview or screening-call invitation, confirmation or reminder (not "interview_invitation"). Use "oa" for online assessments. Use "other" for payroll, timesheet, superannuation, background-check and induction admin.
- "eventDate" is any date referenced in the email (interview date, assessment deadline, etc.) in ISO format (YYYY-MM-DD). If no specific date is mentioned, return null.
- "confidence": "high" if company and role are clearly stated, "medium" if you had to infer the company from context, "low" if uncertain.`;

const EXTRACT_CONCURRENCY = 3;

export async function extractEmails(
  emails: { id: string; from: string; subject: string; bodyText: string }[],
  userId?: string
): Promise<Map<string, ExtractionResult>> {
  const results = new Map<string, ExtractionResult>();
  let failed = 0;

  for (let i = 0; i < emails.length; i += EXTRACT_CONCURRENCY) {
    const batch = emails.slice(i, i + EXTRACT_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((email) => extractSingle(email, userId))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled" && result.value) {
        results.set(batch[j].id, result.value);
      } else {
        failed++;
        if (result.status === "rejected") {
          console.error(
            `Extraction rejected for "${batch[j].subject.slice(0, 60)}":`,
            result.reason
          );
        }
      }
    }
  }

  // A silent drop here strands the email forever: it keeps extractedAt = null,
  // never links to an application, and never surfaces anywhere in the UI.
  if (failed > 0) {
    console.error(
      `Extraction: ${failed}/${emails.length} emails produced no result and will not become applications.`
    );
  }

  return results;
}

async function extractSingle(
  email: {
    id: string;
    from: string;
    subject: string;
    bodyText: string;
  },
  userId?: string
): Promise<ExtractionResult | null> {
  const userContent = `From: ${email.from}\nSubject: ${email.subject}\n\n${email.bodyText.slice(0, 6000)}`;

  try {
    const response = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          // Also inert today: Sonnet 4.6's minimum cacheable prefix is 1,024
          // tokens and this prompt is about 500. Kept for the same reason as
          // the classifier's — see the note there.
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      // Constrains the response to the schema, so an invented enum value like
      // "interview_invitation" can no longer reach zod and lose the email.
      output_config: { format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA } },
      messages: [{ role: "user", content: userContent }],
    });

    // Before the truncation check on purpose: a call cut off at max_tokens is
    // still billed in full, and those are the ones worth seeing in the ledger.
    if (userId) {
      await recordUsage({
        userId,
        operation: "extract",
        model: EXTRACT_MODEL,
        items: 1,
        usage: response.usage,
      });
    }

    if (response.stop_reason === "max_tokens") {
      console.error(
        `Extraction truncated for "${email.subject.slice(0, 60)}" — raise max_tokens.`
      );
      return null;
    }

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    const value = extractJson(text);
    if (value === null) {
      console.error(
        `Extraction: no JSON in response for "${email.subject.slice(0, 60)}". Raw:`,
        text.slice(0, 300)
      );
      return null;
    }

    const parsed = ExtractionResultSchema.safeParse(value);
    if (!parsed.success) {
      console.error(
        `Extraction: schema mismatch for "${email.subject.slice(0, 60)}".`,
        JSON.stringify(value).slice(0, 300),
        JSON.stringify(parsed.error.issues).slice(0, 300)
      );
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.error(`Extraction failed for email ${email.id}:`, error);
    return null;
  }
}

/**
 * Structured outputs return bare JSON, but keep tolerating fenced or
 * prose-wrapped output so a future model or config change degrades instead of
 * silently dropping every email.
 */
function extractJson(text: string): unknown {
  const s = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

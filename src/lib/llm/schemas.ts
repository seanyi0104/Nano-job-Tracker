import { z } from "zod";

export const EMAIL_TYPE_ENUM = z.enum([
  "applied",
  "recruiter_outreach",
  "interview",
  "oa",
  "rejection",
  "offer",
  "other",
]);

/**
 * A negative verdict the classifier is confident about: mass mail that is not
 * about anybody's application. Re-judging skips these permanently, which is
 * the whole cost story — an inbox is ~95% noise, and paying to re-read the
 * same promotions on every check is where the money went.
 *
 * Only ever set alongside `isJobRelated: false`. It is a property of the mail
 * itself, not of the user's profile, so it deliberately SURVIVES a CV change:
 * a retail promotion is noise under every profile.
 */
export const BULK_AD_TYPE = "bulk_ad";

/**
 * Classification may return one more label than extraction: extraction only
 * ever runs on job-related mail, so `bulk_ad` would be meaningless there and
 * is kept out of its stricter enum.
 */
export const CLASSIFY_EMAIL_TYPE_ENUM = z.enum([
  "applied",
  "recruiter_outreach",
  "interview",
  "oa",
  "rejection",
  "offer",
  "other",
  "bulk_ad",
]);

/**
 * `emailType` is only meaningful when the email IS job-related, so models
 * reasonably answer `null` (or `""`) for the rest. Demanding a strict enum
 * made one such answer fail the whole batch of 12, and the batch fallback then
 * marked all 12 as not-job-related — 300 emails were buried that way on a
 * single run. Absent or unrecognised values now collapse to "other".
 *
 * That fallback is now load-bearing twice over: "other" is also the value that
 * keeps an email in the re-check pool. So a model that fails to answer the
 * bulk-mail question lands on "we will look again later" rather than on the
 * permanent verdict — the failure direction this project keeps choosing.
 */
const LOOSE_EMAIL_TYPE = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? "other" : v),
  CLASSIFY_EMAIL_TYPE_ENUM.catch("other")
);

export const ClassificationResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      isJobRelated: z.boolean(),
      emailType: LOOSE_EMAIL_TYPE,
    })
  ),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

/** JSON Schema mirror for `output_config.format` on the classify call. */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          isJobRelated: { type: "boolean" },
          emailType: {
            anyOf: [
              { type: "string", enum: CLASSIFY_EMAIL_TYPE_ENUM.options },
              { type: "null" },
            ],
          },
        },
        required: ["id", "isJobRelated", "emailType"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

export const ExtractionResultSchema = z.object({
  company: z.string(),
  role: z.string().nullable(),
  emailType: EMAIL_TYPE_ENUM,
  eventDate: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * JSON Schema mirror of ExtractionResultSchema, for `output_config.format`.
 *
 * The prompt alone is not enough: it described `emailType` without listing the
 * allowed values, so the model returned plausible-but-invalid labels
 * ("interview_invitation" instead of "interview") and zod rejected the whole
 * extraction — silently dropping 11 of 17 job-related emails. Constraining the
 * enum at the API level makes that failure impossible rather than unlikely.
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: "string",
      description: "The hiring employer or staffing agency. Never the ATS platform.",
    },
    role: {
      type: ["string", "null"],
      description: "Job title, or null if not stated.",
    },
    emailType: {
      type: "string",
      enum: EMAIL_TYPE_ENUM.options,
    },
    eventDate: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD) referenced in the email, or null.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
  required: ["company", "role", "emailType", "eventDate", "confidence"],
  additionalProperties: false,
} as const;

export const CompanySnapshotSchema = z.object({
  culture: z.string(),
  values: z.array(z.string()),
  engineeringFocus: z.string(),
  interviewThemes: z.array(z.string()),
});

export type CompanySnapshot = z.infer<typeof CompanySnapshotSchema>;

export const InterviewPrepSchema = z.object({
  processOverview: z.string(),
  stages: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    })
  ),
  checklist: z.array(z.string()),
});

export type InterviewPrep = z.infer<typeof InterviewPrepSchema>;

export const BehavioralQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      rationale: z.string(),
    })
  ),
});

export type BehavioralQuestions = z.infer<typeof BehavioralQuestionsSchema>;

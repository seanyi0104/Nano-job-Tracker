import { z } from "zod";

export const RATING_ENUM = z.enum(["S", "A", "B", "C"]);
export type Rating = z.infer<typeof RATING_ENUM>;

export const SEVERITY_ENUM = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof SEVERITY_ENUM>;

/** `[NJT:CV_UPDATE]` response from the job-analysis skill. */
export const CvSummarySchema = z.object({
  headline: z.string(),
  years: z.string().nullable(),
  skills: z.array(z.string()),
  highlights: z.array(z.string()),
});

export type CvSummary = z.infer<typeof CvSummarySchema>;

export const CvUpdateResultSchema = z.object({
  ok: z.literal(true),
  summary: CvSummarySchema,
  storedAt: z.string().optional(),
  // Read back from memory/CV.md after the write; analyze.ts checks it.
  cvVersion: z.string().nullish(),
});

/** `[NJT:ANALYZE]` response from the job-analysis skill. */
export const JdAnalysisSchema = z.object({
  ok: z.literal(true),
  company: z.string(),
  role: z.string(),
  rating: RATING_ENUM,
  matchScore: z.number().int().min(0).max(100),
  verdict: z.string(),
  matches: z.array(
    z.object({
      point: z.string(),
      evidence: z.string(),
    })
  ),
  gaps: z.array(
    z.object({
      gap: z.string(),
      severity: SEVERITY_ENUM,
      mitigation: z.string(),
    })
  ),
  keywords: z.array(z.string()),
  suggestions: z.array(z.string()),
  // Quoted from memory/CV.md: which CV the analysis was built on. Absent from
  // analyses stored before CV versions existed.
  cvVersion: z.string().nullish(),
});

export type JdAnalysis = z.infer<typeof JdAnalysisSchema>;

/** The agent returns this instead when no CV has been stored yet. */
export const AgentFailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

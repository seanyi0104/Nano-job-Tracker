export const APPLICATION_STATUSES = [
  "APPLIED",
  "OA",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_PRECEDENCE: Record<ApplicationStatus, number> = {
  APPLIED: 1,
  OA: 2,
  INTERVIEW: 3,
  REJECTED: 4,
  OFFER: 5,
};

/**
 * Which status represents a whole company on the dashboard.
 *
 * Deliberately not STATUS_PRECEDENCE. That ranks events on ONE application,
 * where a rejection arriving after an interview is the newer truth. Across
 * DIFFERENT roles at the same company the opposite holds: one dead application
 * must not bury a live interview, so REJECTED sinks to the bottom.
 */
export const COMPANY_STATUS_RANK: Record<ApplicationStatus, number> = {
  OFFER: 5,
  INTERVIEW: 4,
  OA: 3,
  APPLIED: 2,
  REJECTED: 1,
};

/**
 * Coarse lifecycle buckets for the dashboard funnel. The five detailed
 * statuses stay the source of truth — this is a view over them.
 */
export const OUTCOMES = ["PENDING", "SUCCESS", "FAIL"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const STATUS_TO_OUTCOME: Record<ApplicationStatus, Outcome> = {
  APPLIED: "PENDING",
  OA: "PENDING",
  INTERVIEW: "PENDING",
  OFFER: "SUCCESS",
  REJECTED: "FAIL",
};

export const EMAIL_TYPES = [
  "applied",
  "recruiter_outreach",
  "interview",
  "oa",
  "rejection",
  "offer",
  "other",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

export const SYNC_STATUSES = ["idle", "running", "error"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_PHASES = ["fetching", "classifying", "extracting"] as const;
export type SyncPhase = (typeof SYNC_PHASES)[number];

export const EMAIL_TYPE_TO_STATUS: Partial<Record<EmailType, ApplicationStatus>> = {
  applied: "APPLIED",
  oa: "OA",
  interview: "INTERVIEW",
  offer: "OFFER",
  rejection: "REJECTED",
};

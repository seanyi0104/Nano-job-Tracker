import type { ExtractionResult } from "@/lib/llm/schemas";
import type { ApplicationStatus, EmailType } from "@/lib/types";
import { STATUS_PRECEDENCE, EMAIL_TYPE_TO_STATUS } from "@/lib/types";

export interface EmailWithExtraction {
  id: string;
  gmailId: string;
  internalDate: Date;
  extractionResult: ExtractionResult;
}

export interface ExistingApplication {
  id: string;
  companyNormalized: string;
  roleNormalized: string;
  status: ApplicationStatus;
  statusIsManual: boolean;
}

export interface MergeAction {
  type: "create" | "update";
  emailId: string;
  applicationId?: string;
  company: string;
  companyNormalized: string;
  role: string;
  roleNormalized: string;
  newStatus?: ApplicationStatus;
  emailDate: Date;
}

export function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    // Regional suffixes are how the same employer signs different emails —
    // "Acme" and "Acme (Australia)" are one company, not two.
    // Strip the parenthesised part before punctuation removal flattens it
    // into the name.
    .replace(/\((?:[^)]*)\)/g, " ")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\b(inc|llc|corp|co|ltd|limited|technologies|labs|group|holdings)\b/g, "")
    .replace(/\b(australia|australian|au|aus|china|cn|uk|usa|us|global|international)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRole(role: string): string {
  return role
    .toLowerCase()
    .replace(/\(remote\)/gi, "")
    .replace(/\(hybrid\)/gi, "")
    .replace(/-\s*(summer|fall|winter|spring)\s*\d{4}/gi, "")
    .replace(/\b(req|job)\s*#?\s*\w+/gi, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function roleMatches(
  roleA: string,
  roleB: string
): boolean {
  if (roleA === roleB) return true;

  const tokensA = roleA.split(" ").filter(Boolean);
  const tokensB = roleB.split(" ").filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const smaller = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const larger = tokensA.length <= tokensB.length ? tokensB : tokensA;

  let matchCount = 0;
  for (const token of smaller) {
    if (larger.some((t) => t === token || sharesStem(t, token))) {
      matchCount++;
    }
  }

  return matchCount / smaller.length >= 0.7;
}

function sharesStem(a: string, b: string): boolean {
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  const prefixLen = Math.min(minLen, Math.max(4, Math.floor(minLen * 0.75)));
  return a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

export function computeMergeActions(
  emails: EmailWithExtraction[],
  existingApplications: ExistingApplication[]
): MergeAction[] {
  const actions: MergeAction[] = [];
  const workingApps = [...existingApplications];

  const sorted = [...emails].sort(
    (a, b) => a.internalDate.getTime() - b.internalDate.getTime()
  );

  for (const email of sorted) {
    const { extractionResult } = email;
    const compNorm = normalizeCompany(extractionResult.company);
    const role = extractionResult.role ?? "Unknown Role";
    const roleNorm = normalizeRole(role);
    const emailType = extractionResult.emailType as EmailType;
    const targetStatus = EMAIL_TYPE_TO_STATUS[emailType];

    let matchedApp = workingApps.find(
      (app) =>
        app.companyNormalized === compNorm &&
        app.roleNormalized === roleNorm
    );

    if (!matchedApp) {
      matchedApp = workingApps.find(
        (app) =>
          app.companyNormalized === compNorm &&
          roleMatches(app.roleNormalized, roleNorm)
      );
    }

    // An email that names no role cannot be establishing a new distinct role.
    // Attach it to the company's most recently touched application — emails
    // are processed oldest-first, so that is the last one in workingApps.
    // Requiring exactly one match (the old rule) meant the second roleless
    // email for a company minted a duplicate "Unknown Role" card instead.
    if (!matchedApp && extractionResult.role === null) {
      const sameCompanyApps = workingApps.filter(
        (app) => app.companyNormalized === compNorm
      );
      matchedApp = sameCompanyApps.at(-1);
    }

    // "other" is payroll, timesheet, background-check and induction admin.
    // Such an email is usually sent by a third-party service rather than the
    // employer, and the extractor is told to name the employer behind it — but
    // when it could not work out who that is, the company name is the service
    // itself. Attaching to an existing application is still right; minting a
    // new one would put "National Crime Check" on the dashboard as a job.
    if (
      !matchedApp &&
      emailType === "other" &&
      extractionResult.confidence === "low"
    ) {
      continue;
    }

    if (matchedApp) {
      let newStatus: ApplicationStatus | undefined;
      if (
        targetStatus &&
        !matchedApp.statusIsManual &&
        STATUS_PRECEDENCE[targetStatus] >
          STATUS_PRECEDENCE[matchedApp.status]
      ) {
        newStatus = targetStatus;
        matchedApp.status = targetStatus;
      }

      actions.push({
        type: "update",
        emailId: email.id,
        applicationId: matchedApp.id,
        company: extractionResult.company,
        companyNormalized: compNorm,
        role,
        roleNormalized: roleNorm,
        newStatus,
        emailDate: email.internalDate,
      });
    } else {
      const newAppId = `pending_${email.id}`;
      const initialStatus = targetStatus ?? "APPLIED";

      workingApps.push({
        id: newAppId,
        companyNormalized: compNorm,
        roleNormalized: roleNorm,
        status: initialStatus,
        statusIsManual: false,
      });

      actions.push({
        type: "create",
        emailId: email.id,
        applicationId: newAppId,
        company: extractionResult.company,
        companyNormalized: compNorm,
        role,
        roleNormalized: roleNorm,
        newStatus: initialStatus,
        emailDate: email.internalDate,
      });
    }
  }

  return actions;
}

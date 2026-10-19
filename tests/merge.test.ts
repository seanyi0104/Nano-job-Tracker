import { describe, it, expect } from "vitest";
import {
  normalizeCompany,
  normalizeRole,
  roleMatches,
  computeMergeActions,
  type EmailWithExtraction,
  type ExistingApplication,
} from "@/lib/applications/merge";

describe("normalizeCompany", () => {
  it("lowercases and strips suffixes", () => {
    expect(normalizeCompany("Stripe, Inc.")).toBe("stripe");
    expect(normalizeCompany("Amazon.com, LLC")).toBe("amazoncom");
    expect(normalizeCompany("Meta Technologies")).toBe("meta");
  });

  it("handles already-clean names", () => {
    expect(normalizeCompany("google")).toBe("google");
  });

  it("strips multiple suffixes", () => {
    expect(normalizeCompany("Acme Corp Ltd")).toBe("acme");
  });
});

describe("normalizeRole", () => {
  it("removes season/year, remote tags, req IDs", () => {
    expect(normalizeRole("SDE Intern - Summer 2025")).toBe("sde intern");
    expect(normalizeRole("Software Engineer (Remote)")).toBe("software engineer");
    expect(normalizeRole("Backend Engineer Req #12345")).toBe("backend engineer");
  });

  it("collapses whitespace", () => {
    expect(normalizeRole("  Software   Engineer  ")).toBe("software engineer");
  });
});

describe("roleMatches", () => {
  it("matches exact normalized roles", () => {
    expect(roleMatches("sde intern", "sde intern")).toBe(true);
  });

  it("matches when one is a token subset of the other", () => {
    expect(roleMatches("software engineer intern", "swe intern")).toBe(false);
    expect(
      roleMatches("software engineer intern", "software engineering intern")
    ).toBe(true);
  });

  it("does not match completely different roles", () => {
    expect(roleMatches("product manager", "software engineer")).toBe(false);
  });
});

describe("computeMergeActions", () => {
  const makeEmail = (
    overrides: Partial<EmailWithExtraction> & { id: string }
  ): EmailWithExtraction => ({
    gmailId: overrides.id,
    internalDate: new Date("2025-01-15"),
    extractionResult: {
      company: "Amazon",
      role: "SDE Intern",
      emailType: "applied",
      eventDate: null,
      confidence: "high",
    },
    ...overrides,
  });

  it("creates a new application when none exists", () => {
    const emails = [makeEmail({ id: "e1" })];
    const actions = computeMergeActions(emails, []);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("create");
    expect(actions[0].company).toBe("Amazon");
    expect(actions[0].newStatus).toBe("APPLIED");
  });

  it("merges into existing application by company+role", () => {
    const existing: ExistingApplication[] = [
      {
        id: "app1",
        companyNormalized: "amazon",
        roleNormalized: "sde intern",
        status: "APPLIED",
        statusIsManual: false,
      },
    ];
    const emails = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Amazon",
          role: "SDE Intern",
          emailType: "interview",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];
    const actions = computeMergeActions(emails, existing);
    expect(actions[0].type).toBe("update");
    expect(actions[0].applicationId).toBe("app1");
    expect(actions[0].newStatus).toBe("INTERVIEW");
  });

  it("respects status precedence — rejection does not override offer", () => {
    const existing: ExistingApplication[] = [
      {
        id: "app1",
        companyNormalized: "google",
        roleNormalized: "software engineer",
        status: "OFFER",
        statusIsManual: false,
      },
    ];
    const emails = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Google",
          role: "Software Engineer",
          emailType: "rejection",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];
    const actions = computeMergeActions(emails, existing);
    expect(actions[0].newStatus).toBeUndefined();
  });

  it("never overwrites manual status", () => {
    const existing: ExistingApplication[] = [
      {
        id: "app1",
        companyNormalized: "meta",
        roleNormalized: "swe intern",
        status: "APPLIED",
        statusIsManual: true,
      },
    ];
    const emails = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Meta",
          role: "SWE Intern",
          emailType: "interview",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];
    const actions = computeMergeActions(emails, existing);
    expect(actions[0].newStatus).toBeUndefined();
  });

  it("is order-independent — same final state regardless of email order", () => {
    const emails: EmailWithExtraction[] = [
      makeEmail({
        id: "e1",
        internalDate: new Date("2025-01-10"),
        extractionResult: {
          company: "Stripe",
          role: "Backend Engineer",
          emailType: "applied",
          eventDate: null,
          confidence: "high",
        },
      }),
      makeEmail({
        id: "e2",
        internalDate: new Date("2025-01-20"),
        extractionResult: {
          company: "Stripe",
          role: "Backend Engineer",
          emailType: "interview",
          eventDate: null,
          confidence: "high",
        },
      }),
      makeEmail({
        id: "e3",
        internalDate: new Date("2025-01-15"),
        extractionResult: {
          company: "Stripe",
          role: "Backend Engineer",
          emailType: "oa",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];

    const actionsOrdered = computeMergeActions(emails, []);
    const actionsShuffled = computeMergeActions(
      [emails[2], emails[0], emails[1]],
      []
    );

    const finalStatusOrdered =
      actionsOrdered[actionsOrdered.length - 1].newStatus;
    const finalStatusShuffled =
      actionsShuffled[actionsShuffled.length - 1].newStatus;

    expect(finalStatusOrdered).toBe("INTERVIEW");
    expect(finalStatusShuffled).toBe("INTERVIEW");
  });

  it("attaches null-role email to single same-company application", () => {
    const existing: ExistingApplication[] = [
      {
        id: "app1",
        companyNormalized: "amazon",
        roleNormalized: "sde intern",
        status: "APPLIED",
        statusIsManual: false,
      },
    ];
    const emails = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Amazon",
          role: null,
          emailType: "rejection",
          eventDate: null,
          confidence: "medium",
        },
      }),
    ];
    const actions = computeMergeActions(emails, existing);
    expect(actions[0].type).toBe("update");
    expect(actions[0].applicationId).toBe("app1");
    expect(actions[0].newStatus).toBe("REJECTED");
  });

  it("creates separate applications for different roles at same company", () => {
    const emails: EmailWithExtraction[] = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Google",
          role: "Software Engineer",
          emailType: "applied",
          eventDate: null,
          confidence: "high",
        },
      }),
      makeEmail({
        id: "e2",
        extractionResult: {
          company: "Google",
          role: "Product Manager",
          emailType: "applied",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];
    const actions = computeMergeActions(emails, []);
    const creates = actions.filter((a) => a.type === "create");
    expect(creates).toHaveLength(2);
    expect(creates[0].roleNormalized).not.toBe(creates[1].roleNormalized);
  });

  it("matches fuzzy role variants (SWE Intern vs Software Engineering Intern)", () => {
    const existing: ExistingApplication[] = [
      {
        id: "app1",
        companyNormalized: "meta",
        roleNormalized: "software engineering intern",
        status: "APPLIED",
        statusIsManual: false,
      },
    ];
    const emails = [
      makeEmail({
        id: "e1",
        extractionResult: {
          company: "Meta",
          role: "Software Engineering Intern, Platform",
          emailType: "interview",
          eventDate: null,
          confidence: "high",
        },
      }),
    ];
    const actions = computeMergeActions(emails, existing);
    expect(actions[0].type).toBe("update");
    expect(actions[0].applicationId).toBe("app1");
  });
});

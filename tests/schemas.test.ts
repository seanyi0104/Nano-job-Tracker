import { describe, it, expect } from "vitest";
import {
  ClassificationResultSchema,
  ExtractionResultSchema,
  CompanySnapshotSchema,
  InterviewPrepSchema,
  BehavioralQuestionsSchema,
} from "@/lib/llm/schemas";

describe("ClassificationResultSchema", () => {
  it("accepts valid classification output", () => {
    const valid = {
      results: [
        { id: "msg001", isJobRelated: true, emailType: "applied" },
        { id: "msg002", isJobRelated: false, emailType: "other" },
      ],
    };
    expect(ClassificationResultSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts bulk_ad, the permanent negative verdict", () => {
    const valid = {
      results: [{ id: "msg001", isJobRelated: false, emailType: "bulk_ad" }],
    };
    const parsed = ClassificationResultSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.results[0].emailType).toBe("bulk_ad");
  });

  // Unknown labels must NOT fail the batch. Rejecting them is what buried 300
  // emails: one unparseable entry failed all 12, and the fallback marked the
  // whole batch not-job-related. They collapse to "other", which also keeps
  // the email in the re-check pool rather than stamping it permanently.
  it("coerces an unknown emailType to other rather than rejecting", () => {
    const unknown = {
      results: [{ id: "msg001", isJobRelated: true, emailType: "invalid_type" }],
    };
    const parsed = ClassificationResultSchema.safeParse(unknown);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.results[0].emailType).toBe("other");
  });

  it("coerces a null emailType to other", () => {
    const nulled = {
      results: [{ id: "msg001", isJobRelated: false, emailType: null }],
    };
    const parsed = ClassificationResultSchema.safeParse(nulled);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.results[0].emailType).toBe("other");
  });

  it("rejects missing fields", () => {
    const invalid = { results: [{ id: "msg001" }] };
    expect(ClassificationResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("ExtractionResultSchema", () => {
  it("accepts valid extraction with nullable fields", () => {
    const valid = {
      company: "Amazon",
      role: null,
      emailType: "applied",
      eventDate: null,
      confidence: "high",
    };
    expect(ExtractionResultSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts full extraction", () => {
    const valid = {
      company: "Google",
      role: "Software Engineer Intern",
      emailType: "interview",
      eventDate: "2025-02-15",
      confidence: "medium",
    };
    expect(ExtractionResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing company", () => {
    const invalid = {
      role: "SDE",
      emailType: "applied",
      eventDate: null,
      confidence: "high",
    };
    expect(ExtractionResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("CompanySnapshotSchema", () => {
  it("accepts valid snapshot", () => {
    const valid = {
      culture: "Innovation-focused engineering culture",
      values: ["Customer Obsession", "Ownership", "Bias for Action"],
      engineeringFocus: "Distributed systems and cloud computing",
      interviewThemes: ["System design", "Leadership principles"],
    };
    expect(CompanySnapshotSchema.safeParse(valid).success).toBe(true);
  });
});

describe("InterviewPrepSchema", () => {
  it("accepts valid interview prep", () => {
    const valid = {
      processOverview: "Amazon uses a structured interview process.",
      stages: [
        { name: "Online Assessment", description: "Coding problems on HackerRank" },
        { name: "Phone Screen", description: "45-min technical interview" },
      ],
      checklist: ["Review data structures", "Prepare STAR stories"],
    };
    expect(InterviewPrepSchema.safeParse(valid).success).toBe(true);
  });
});

describe("BehavioralQuestionsSchema", () => {
  it("accepts valid questions list", () => {
    const valid = {
      questions: [
        {
          question: "Tell me about a time you showed ownership.",
          rationale: "Amazon values ownership as a core leadership principle.",
        },
      ],
    };
    expect(BehavioralQuestionsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects questions without rationale", () => {
    const invalid = {
      questions: [{ question: "Tell me about yourself" }],
    };
    expect(BehavioralQuestionsSchema.safeParse(invalid).success).toBe(false);
  });
});

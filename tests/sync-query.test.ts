import { describe, it, expect } from "vitest";
import { buildQuery, buildRangeQuery } from "@/lib/gmail/sync";

describe("buildQuery", () => {
  it("resumes a day before the watermark, to catch mail that arrived late", () => {
    const q = buildQuery(new Date("2026-09-04T05:15:07Z"));
    expect(q).toBe(`after:${Date.parse("2026-09-03T05:15:07Z") / 1000} -in:chat`);
  });

  // A Reset that could not download everything parks the watermark at the
  // start of its range so the next Update lists the range again. The day of
  // overlap must not then reach outside the tracking window.
  it("never reaches back past the start of the tracking window", () => {
    const start = new Date("2026-03-01T00:00:00Z");
    const q = buildQuery(start, start);
    expect(q).toBe(`after:${start.getTime() / 1000} -in:chat`);
  });

  it("falls back to the first-sync lookback when there is no watermark", () => {
    expect(buildQuery(null)).toBe("newer_than:90d -in:chat");
  });
});

describe("buildRangeQuery", () => {
  // The 90-day lookback is a product choice about a sensible first sync, not a
  // Gmail limitation. A job hunt runs longer than a quarter, so Reset has to be
  // able to reach past it — this test is the guard on that claim.
  it("reaches arbitrarily far back", () => {
    const q = buildRangeQuery(
      new Date("2024-01-01T00:00:00Z"),
      new Date("2026-09-01T00:00:00Z")
    );
    expect(q).toBe("after:1704067200 before:1788220800 -in:chat");
    expect(q).not.toContain("newer_than");
  });

  it("keeps the structural chat filter and nothing else", () => {
    const q = buildRangeQuery(
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-08-10T00:00:00Z")
    );
    // Promotions and Social stay in scope on purpose: ATS mail lands there.
    expect(q).not.toContain("category");
    expect(q).not.toContain("in:inbox");
    expect(q).toContain("-in:chat");
  });
});

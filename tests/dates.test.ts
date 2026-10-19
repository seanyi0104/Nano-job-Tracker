import { describe, it, expect } from "vitest";
import { isoDate, defaultResetStart } from "@/lib/dates";

describe("isoDate", () => {
  // The date inputs and the server's parseRange both read YYYY-MM-DD as a
  // local date. The UTC date is a day off near one end of the day in every
  // timezone except UTC itself — in Sydney, every morning.
  it("gives the local calendar date at both ends of the day", () => {
    expect(isoDate(new Date(2026, 2, 1, 0, 30))).toBe("2026-03-01");
    expect(isoDate(new Date(2026, 2, 1, 23, 30))).toBe("2026-03-01");
  });
});

describe("defaultResetStart", () => {
  it("starts from the tracking window, so accepting the default keeps what is tracked", () => {
    // Stored as UTC, like SyncState.windowStart: Sydney's 3/1 is 2/28 in UTC.
    const windowStart = new Date(2026, 2, 1).toISOString();
    expect(defaultResetStart(windowStart, new Date(2026, 8, 28))).toBe("2026-03-01");
  });

  it("falls back to six months back when nothing is tracked yet", () => {
    expect(defaultResetStart(null, new Date(2026, 8, 28, 9, 0))).toBe("2026-03-28");
  });
});

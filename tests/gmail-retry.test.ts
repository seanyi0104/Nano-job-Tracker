import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { getMessage, isRetryable } from "@/lib/gmail/client";

// The body Gmail actually returned 127 times during the 2026-09-18 Update,
// trimmed to the parts that identify it.
const QUOTA_403 = JSON.stringify({
  error: {
    code: 403,
    message:
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'.",
    errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }],
    status: "PERMISSION_DENIED",
  },
});

const SCOPE_403 = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ domain: "global", reason: "insufficientPermissions" }],
    status: "PERMISSION_DENIED",
  },
});

describe("isRetryable", () => {
  it("retries Gmail's per-minute quota, which it reports as a 403", () => {
    expect(isRetryable(403, QUOTA_403)).toBe(true);
  });

  it("retries 429 and server errors", () => {
    expect(isRetryable(429, "")).toBe(true);
    expect(isRetryable(503, "")).toBe(true);
  });

  it("does not retry a 403 that will fail the same way every time", () => {
    expect(isRetryable(403, SCOPE_403)).toBe(false);
    expect(isRetryable(404, "")).toBe(false);
  });
});

describe("gmailFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits out a quota 403 and returns the message", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(QUOTA_403, { status: 403 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "m1", snippet: "hi" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = getMessage("token", "m1");
    await vi.advanceTimersByTimeAsync(3_000); // first wait: 2 s + up to 1 s jitter
    await expect(pending).resolves.toMatchObject({ id: "m1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up at once on a 403 that is not about rate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(SCOPE_403, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMessage("token", "m1")).rejects.toThrow("Gmail API error: 403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

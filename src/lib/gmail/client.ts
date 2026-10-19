import { prisma } from "@/lib/db";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class ReauthRequiredError extends Error {
  constructor() {
    super("Gmail access expired. Please reconnect your account.");
    this.name = "ReauthRequiredError";
  }
}

export async function getFreshAccessToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirstOrThrow({
    where: { userId, provider: "google" },
  });

  if (!account.access_token) {
    throw new ReauthRequiredError();
  }

  if (account.expires_at && account.expires_at * 1000 > Date.now() + 60_000) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new ReauthRequiredError();
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (body.error === "invalid_grant") {
      throw new ReauthRequiredError();
    }
    throw new Error(`Token refresh failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const tokens = await response.json();

  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: tokens.access_token,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
    },
  });

  return tokens.access_token;
}

export interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailMessageResponse {
  id: string;
  threadId: string;
  internalDate: string;
  snippet: string;
  payload: GmailPayload;
}

export interface GmailPayload {
  mimeType: string;
  headers: { name: string; value: string }[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPayload[];
}

export async function listMessages(
  accessToken: string,
  query: string,
  pageToken?: string
): Promise<GmailMessageListResponse> {
  const params = new URLSearchParams({ q: query, maxResults: "100" });
  if (pageToken) params.set("pageToken", pageToken);

  const response = await gmailFetch(
    `${GMAIL_API_BASE}/messages?${params}`,
    accessToken
  );
  return response.json();
}

export async function getMessage(
  accessToken: string,
  messageId: string
): Promise<GmailMessageResponse> {
  const response = await gmailFetch(
    `${GMAIL_API_BASE}/messages/${messageId}?format=full`,
    accessToken
  );
  return response.json();
}

// Gmail's per-user quota is counted per minute, so a burst that trips it can
// take most of a minute to clear. These waits add up to just over a minute
// before a message is given up on.
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

/**
 * Whether a failed Gmail response is worth asking again.
 *
 * Gmail says "slow down" two ways: 429, and a 403 whose reason is
 * rateLimitExceeded or userRateLimitExceeded — "Quota exceeded for quota
 * metric 'Total Query Cost' and limit 'Units per minute per user'". Both clear
 * on their own. Only 429 used to be retried, so on 2026-09-18 an Update that
 * outran the per-minute quota dropped 127 of 264 new emails, one 403 each.
 * A 403 for any other reason — a missing scope, a revoked grant — will fail
 * the same way every time, so it is not retried.
 */
export function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(body);
}

async function gmailFetch(url: string, accessToken: string): Promise<Response> {
  let lastProblem = "";
  let retryAfterMs = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      // Jitter, so five requests throttled together do not all come back
      // in the same instant and trip the quota again.
      const wait = Math.max(RETRY_DELAYS_MS[attempt - 1], retryAfterMs);
      await sleep(wait + Math.random() * 1000);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      // A dropped connection says nothing about the request itself.
      lastProblem = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (response.ok) return response;

    const body = await response.text();
    if (!isRetryable(response.status, body)) {
      throw new Error(`Gmail API error: ${response.status} ${body}`);
    }
    lastProblem = `${response.status} ${body.slice(0, 200)}`;
    retryAfterMs = (Number(response.headers.get("Retry-After")) || 0) * 1000;
  }

  throw new Error(
    `Gmail API: still failing after ${RETRY_DELAYS_MS.length + 1} attempts — ${lastProblem}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

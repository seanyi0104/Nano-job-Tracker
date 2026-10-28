/**
 * Thin bridge to the nanobot agent.
 *
 * nanobot ships an OpenAI-compatible HTTP server (`nanobot serve`), so the
 * whole integration is one fetch. Nothing in nanobot's source is modified —
 * behaviour is steered by the `job-analysis` skill in its workspace.
 */

const NANOBOT_URL =
  process.env.NANOBOT_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8900";

const NANOBOT_TIMEOUT_MS = Number(process.env.NANOBOT_TIMEOUT_MS ?? 180_000);

export const NANOBOT_MODEL = process.env.NANOBOT_MODEL ?? "nanobot";

export class NanobotError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NanobotError";
  }
}

/**
 * Send one user message to a nanobot session and return the assistant text.
 *
 * `sessionId` keeps conversations isolated; analyze.ts gives every call a
 * fresh one. Long-term memory (the CV) is workspace-level, so it is shared
 * across sessions — that is exactly what lets an analysis recall a CV that
 * another session wrote.
 */
export async function nanobotChat(
  message: string,
  sessionId: string
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.NANOBOT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.NANOBOT_API_KEY}`;
  }

  let response: Response;
  try {
    response = await fetch(`${NANOBOT_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
        session_id: sessionId,
        stream: false,
      }),
      signal: AbortSignal.timeout(NANOBOT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NanobotError(
      `Cannot reach nanobot at ${NANOBOT_URL}. Is \`nanobot serve\` running?`,
      error
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new NanobotError(
      `nanobot returned ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new NanobotError("nanobot returned an empty response");
  }
  return content;
}

/** Probe the agent so the UI can tell "engine offline" from "analysis failed". */
export async function nanobotHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${NANOBOT_URL}/health`, {
      // Short: this runs on every page render, so an offline engine must not
      // stall the whole dashboard.
      signal: AbortSignal.timeout(1_500),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

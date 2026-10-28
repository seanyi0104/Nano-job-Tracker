import { createHash } from "node:crypto";

/**
 * Fingerprint of the CV text pushed to nanobot.
 *
 * The CV lives in nanobot's memory, out of this app's reach, so the only proof
 * that an answer was built on the CV saved here is the agent quoting this back:
 * it is written into memory/CV.md with the CV, and every reply that depends on
 * the CV must return it. Without that check a stale answer looks exactly like
 * a fresh one — in 2026-10 every JD analysis since 08-09 turned out to have
 * used the CV read that day, and every one of them parsed fine.
 *
 * A hash rather than a timestamp: saving the same CV twice is the same
 * version, so analyses made in between stay current.
 */
export function cvVersionOf(cvText: string): string {
  return createHash("sha256").update(cvText).digest("hex").slice(0, 12);
}

/** The line memory/CV.md carries the version on. The skill names it too. */
export const CV_VERSION_PREFIX = "> 简历版本 / CV version:";

/** The CV as nanobot stores it: the version line, then the CV itself. */
export function stampCv(cvText: string): string {
  return `${CV_VERSION_PREFIX} ${cvVersionOf(cvText)}\n\n${cvText}`;
}

/**
 * The version an agent quoted. Agents copy loosely — the whole line, a
 * read_file line number, a capital letter — so take the hash out of whatever
 * came back. Leniency costs nothing here: the right hash cannot be produced
 * without reading the file.
 */
export function readQuotedVersion(value: string | null | undefined): string | null {
  return value?.match(/[0-9a-f]{12}/i)?.[0].toLowerCase() ?? null;
}

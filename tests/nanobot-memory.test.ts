import { describe, it, expect, vi, beforeEach } from "vitest";

// Only the network call is faked. Session ids, the version stamp and the
// version check are the real code under test.
const chat = vi.fn();
vi.mock("@/lib/nanobot/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nanobot/client")>();
  return { ...actual, nanobotChat: (...args: unknown[]) => chat(...args) };
});

import {
  analyzeJdWithNanobot,
  parseCvText,
  pushCvToMemory,
  StaleCvError,
} from "@/lib/nanobot/analyze";
import { NanobotError } from "@/lib/nanobot/client";
import { cvVersionOf, stampCv } from "@/lib/nanobot/cv-version";

const CV = "# Test Person\n\n## 技能 / Skills\n- **编程语言**: Python";
const VERSION = cvVersionOf(CV);

function analysisReply(cvVersion?: string | null): string {
  return JSON.stringify({
    ok: true,
    company: "Acme",
    role: "Product Intern",
    rating: "B",
    matchScore: 60,
    verdict: "Worth applying after one fix",
    matches: [{ point: "Python", evidence: "Python in skills" }],
    gaps: [{ gap: "No SQL", severity: "low", mitigation: "Add a SQL project" }],
    keywords: ["Python"],
    suggestions: ["Add SQL"],
    ...(cvVersion === undefined ? {} : { cvVersion }),
  });
}

function cvUpdateReply(cvVersion?: string): string {
  return JSON.stringify({
    ok: true,
    summary: { headline: "Test", years: null, skills: ["Python"], highlights: [] },
    storedAt: "memory/CV.md",
    ...(cvVersion === undefined ? {} : { cvVersion }),
  });
}

const sessionOf = (call: number) => chat.mock.calls[call][1] as string;
const messageOf = (call: number) => chat.mock.calls[call][0] as string;

beforeEach(() => chat.mockReset());

// One shared session per user let the agent read CV.md once (08-09) and then
// answer every later analysis from the copy in its history.
describe("nanobot sessions", () => {
  it("gives every analysis a session of its own", async () => {
    chat.mockResolvedValue(analysisReply(VERSION));
    await analyzeJdWithNanobot("u1", "JD one", VERSION);
    await analyzeJdWithNanobot("u1", "JD two", VERSION);

    expect(sessionOf(0)).toMatch(/^njt:analyze:u1:/);
    expect(sessionOf(1)).toMatch(/^njt:analyze:u1:/);
    expect(sessionOf(0)).not.toBe(sessionOf(1));
  });

  it("gives every CV save a session of its own", async () => {
    chat.mockResolvedValue(cvUpdateReply(VERSION));
    await pushCvToMemory("u1", CV);
    await pushCvToMemory("u1", CV);

    expect(sessionOf(0)).toMatch(/^njt:cv:u1:/);
    expect(sessionOf(0)).not.toBe(sessionOf(1));
  });

  it("keeps a CV parse and its corrective retry in one session", async () => {
    chat
      .mockResolvedValueOnce(JSON.stringify({ parsed: {} }))
      .mockResolvedValueOnce(JSON.stringify({ basics: { name: "Test Person" } }));

    const cv = await parseCvText("u1", "Test Person\nPython");

    expect(cv.basics.name).toBe("Test Person");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(sessionOf(1)).toBe(sessionOf(0));
  });
});

describe("CV version check", () => {
  it("accepts an analysis that quotes the CV saved now", async () => {
    chat.mockResolvedValue(analysisReply(VERSION));
    const analysis = await analyzeJdWithNanobot("u1", "JD", VERSION);
    expect(analysis.cvVersion).toBe(VERSION);
  });

  it("accepts the quote even with the line copied around it", async () => {
    chat.mockResolvedValue(analysisReply(`3| > 简历版本 / CV version: ${VERSION.toUpperCase()}`));
    const analysis = await analyzeJdWithNanobot("u1", "JD", VERSION);
    expect(analysis.cvVersion).toBe(VERSION);
  });

  it("refuses an analysis built on another CV", async () => {
    chat.mockResolvedValue(analysisReply(cvVersionOf("an older CV")));
    await expect(analyzeJdWithNanobot("u1", "JD", VERSION)).rejects.toBeInstanceOf(
      StaleCvError
    );
  });

  it("refuses an analysis that quotes no version at all", async () => {
    for (const quoted of [undefined, null, ""]) {
      chat.mockResolvedValue(analysisReply(quoted));
      await expect(analyzeJdWithNanobot("u1", "JD", VERSION)).rejects.toBeInstanceOf(
        StaleCvError
      );
    }
  });

  // The version stays on this side; sending it would let the agent echo it
  // without reading CV.md, and the check would prove nothing.
  it("sends neither the CV nor its version with the JD", async () => {
    chat.mockResolvedValue(analysisReply(VERSION));
    await analyzeJdWithNanobot("u1", "the JD text", VERSION);

    expect(messageOf(0)).toContain("[NJT:ANALYZE]");
    expect(messageOf(0)).toContain("the JD text");
    expect(messageOf(0)).not.toContain(VERSION);
    expect(messageOf(0)).not.toContain("Test Person");
  });

  it("writes the CV with its version line and wants that version read back", async () => {
    chat.mockResolvedValue(cvUpdateReply(VERSION));
    const result = await pushCvToMemory("u1", CV);

    expect(messageOf(0)).toContain(stampCv(CV));
    expect(result.cvVersion).toBe(VERSION);
  });

  it("fails a CV save the agent did not confirm", async () => {
    chat.mockResolvedValue(cvUpdateReply());
    await expect(pushCvToMemory("u1", CV)).rejects.toBeInstanceOf(NanobotError);
  });

  it("changes the version whenever the CV text changes, and only then", () => {
    expect(cvVersionOf(CV)).toBe(VERSION);
    expect(cvVersionOf(`${CV} `)).not.toBe(VERSION);
    expect(VERSION).toMatch(/^[0-9a-f]{12}$/);
  });
});

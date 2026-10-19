import { nanobotChat, NanobotError } from "./client";
import {
  AgentFailureSchema,
  CvUpdateResultSchema,
  JdAnalysisSchema,
} from "./schemas";
import type { CvSummary, JdAnalysis } from "./schemas";
import { StructuredCvSchema, isCvEmpty } from "./cv-schema";
import type { StructuredCv } from "./cv-schema";
import { coerceAgentCv } from "./cv-coerce";

/** Raised when the agent explicitly reports it has no CV in memory. */
export class NoCvError extends Error {
  constructor() {
    super("No CV stored in nanobot memory yet");
    this.name = "NoCvError";
  }
}

const cvSession = (userId: string) => `njt:cv:${userId}`;
const analyzeSession = (userId: string) => `njt:analyze:${userId}`;

/**
 * Naming the skill explicitly is cheap insurance: the agent only sees skill
 * *descriptions* up front and decides for itself whether to load the body.
 */
const USE_SKILL = "Load and follow the `job-analysis` skill.";

/**
 * Push the CV into nanobot's long-term memory (workspace/memory/CV.md) and
 * get back a structured summary. nanobot owns the CV; the local DB row is
 * only a mirror for the editor UI.
 */
export async function pushCvToMemory(
  userId: string,
  cvText: string
): Promise<CvSummary> {
  const reply = await nanobotChat(
    `${USE_SKILL}\n\n[NJT:CV_UPDATE]\n\n${cvText}`,
    cvSession(userId)
  );
  const parsed = parseAgentJson(reply, CvUpdateResultSchema);
  return parsed.summary;
}

/**
 * Turn raw CV text (pasted, or extracted from an upload) into structured
 * fields. Parsing only — nothing is written to memory here, so the user can
 * review and correct the fields before they become the agent's CV.
 */
export async function parseCvText(
  userId: string,
  cvText: string
): Promise<StructuredCv> {
  const attempt = async (instruction: string): Promise<StructuredCv> => {
    const reply = await nanobotChat(instruction, cvSession(userId));
    const raw = extractJsonObject(reply);
    if (!raw) {
      throw new NanobotError(`No JSON in CV parse reply: ${reply.slice(0, 200)}`);
    }
    const parsed = StructuredCvSchema.safeParse(coerceAgentCv(JSON.parse(raw)));
    if (!parsed.success) {
      throw new NanobotError("CV parse reply did not match the expected shape");
    }
    return parsed.data;
  };

  const first = await attempt(`${USE_SKILL}\n\n[NJT:CV_PARSE]\n\n${cvText}`);
  if (!isCvEmpty(first)) return first;

  // Every field in StructuredCv has a default, so a reply in the wrong shape
  // parses "successfully" into an empty CV. Emptiness is therefore the real
  // failure signal — one corrective retry, then surface it rather than
  // handing the UI a blank form labelled success.
  const second = await attempt(
    `${USE_SKILL}\n\n[NJT:CV_PARSE]\n\n` +
      `Your previous reply could not be used: the JSON keys did not match the ` +
      `schema in the skill. Return ONLY the object with these exact top-level ` +
      `keys — "basics", "education", "experience", "projects", "skills", ` +
      `"awards" — and no wrapper such as {"ok":...} or {"parsed":...}.\n\n` +
      cvText
  );
  if (isCvEmpty(second)) {
    throw new CvParseError();
  }
  return second;
}

/** The agent replied, but nothing usable came out of it. */
export class CvParseError extends Error {
  constructor() {
    super(
      "nanobot could not turn that CV into fields. Try again, or fill in the fields below by hand and click Save CV."
    );
    this.name = "CvParseError";
  }
}

/**
 * Ask the agent to break down a JD and match it against the CV it already
 * remembers. The CV is deliberately NOT passed in — recalling it is the
 * agent's job, and that is what makes this a memory-backed pipeline rather
 * than a stateless prompt.
 */
export async function analyzeJdWithNanobot(
  userId: string,
  jdText: string
): Promise<JdAnalysis> {
  const reply = await nanobotChat(
    `${USE_SKILL}\n\n[NJT:ANALYZE]\n\n${jdText}`,
    analyzeSession(userId)
  );
  return parseAgentJson(reply, JdAnalysisSchema);
}

/**
 * Agents are chattier than a raw completion API, so pull the JSON object out
 * of whatever wrapping came back before validating it.
 */
function parseAgentJson<T>(
  reply: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } }
): T {
  const raw = extractJsonObject(reply);
  if (!raw) {
    throw new NanobotError(
      `nanobot did not return JSON: ${reply.slice(0, 200)}`
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new NanobotError(`nanobot returned malformed JSON`, error);
  }

  // The skill returns {ok:false,error:"NO_CV"} when memory is empty.
  const failure = AgentFailureSchema.safeParse(value);
  if (failure.success) {
    if (failure.data.error === "NO_CV") throw new NoCvError();
    throw new NanobotError(`nanobot reported: ${failure.data.error}`);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NanobotError(
      `nanobot JSON did not match the expected shape: ${raw.slice(0, 200)}`
    );
  }
  return parsed.data as T;
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

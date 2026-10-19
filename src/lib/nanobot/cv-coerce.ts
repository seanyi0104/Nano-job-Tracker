/**
 * Normalise whatever shape the agent returns for `[NJT:CV_PARSE]` into
 * StructuredCv.
 *
 * nanobot's OpenAI-compatible endpoint has no `response_format`, so unlike the
 * Claude calls there is no way to constrain the reply at the API level — the
 * skill file asks for exact field names and the model answers with its own
 * ("targetRole" for basics.jobTarget, "achievements" for bullets, a "period"
 * string instead of start/end dates, the whole thing wrapped in
 * {ok, parsed}). The content is right; only the labels drift.
 *
 * Rejecting those replies would mean telling the user "parsing failed" while
 * holding a perfectly good parse, so map the common aliases instead. Anything
 * genuinely unrecognisable still ends up empty, and the caller treats an empty
 * result as a failure rather than showing a blank form as success.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** Pick the first alias that carries a value. */
const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const strAt = (o: Obj, ...keys: string[]): string => str(pick(o, ...keys));

/** Accept a string, a string[], or an object of string[] and flatten. */
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[\n;,、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (isObj(v)) return Object.values(v).flatMap(toList);
  return [];
}

/**
 * "Feb 2026 – Jul 2027 (Expected)" -> ["Feb 2026", "Jul 2027"].
 * Models routinely answer with one range string where the schema wants two
 * fields, and losing the dates would gut the CV.
 */
function splitPeriod(period: string): [string, string] {
  if (!period) return ["", ""];
  const parts = period.split(/\s*(?:–|—|-|~|to|至)\s*/i).filter(Boolean);
  if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(" ").trim()];
  return [period.trim(), ""];
}

function dates(o: Obj): { startDate: string; endDate: string } {
  const start = strAt(o, "startDate", "start_date", "start", "from");
  const end = strAt(o, "endDate", "end_date", "end", "to", "until");
  if (start || end) return { startDate: start, endDate: end };
  const [s, e] = splitPeriod(strAt(o, "period", "dates", "duration", "时间"));
  return { startDate: s, endDate: e };
}

export function coerceAgentCv(input: unknown): unknown {
  if (!isObj(input)) return {};

  // Unwrap the envelopes models like to add.
  let root = input;
  for (const key of ["parsed", "cv", "data", "result", "profile", "resume"]) {
    const inner = root[key];
    if (isObj(inner)) {
      root = inner;
      break;
    }
  }

  const basicsSrc = isObj(root.basics) ? (root.basics as Obj) : root;
  const contact = isObj(root.contact) ? (root.contact as Obj) : {};

  const basics = {
    name: strAt(basicsSrc, "name", "fullName", "姓名") || strAt(root, "name"),
    phone: strAt(basicsSrc, "phone", "tel", "mobile") || strAt(contact, "phone", "tel", "mobile"),
    email: strAt(basicsSrc, "email") || strAt(contact, "email"),
    location:
      strAt(basicsSrc, "location", "city", "address") ||
      strAt(contact, "location", "city", "address"),
    links: toList(
      pick(basicsSrc, "links", "urls", "websites") ?? pick(contact, "links", "urls")
    ),
    jobTarget: strAt(
      basicsSrc,
      "jobTarget",
      "targetRole",
      "target_role",
      "objective",
      "desiredRole",
      "求职意向"
    ),
    summary: strAt(basicsSrc, "summary", "profile", "about", "个人简介"),
  };

  const education = asArray(root.education ?? root.educations).map((raw) => {
    const e = isObj(raw) ? raw : {};
    return {
      school: strAt(e, "school", "institution", "university", "学校"),
      degree: strAt(e, "degree", "qualification", "学位"),
      major: strAt(e, "major", "field", "fieldOfStudy", "专业"),
      ...dates(e),
      gpa: strAt(e, "gpa", "wam", "grade", "score"),
      highlights: toList(
        pick(e, "highlights", "coursework", "details", "courses", "achievements")
      ),
    };
  });

  const experience = asArray(
    root.experience ?? root.experiences ?? root.work ?? root.employment
  ).map((raw) => {
    const x = isObj(raw) ? raw : {};
    return {
      company: strAt(x, "company", "employer", "organisation", "organization", "公司"),
      title: strAt(x, "title", "role", "position", "职位"),
      location: strAt(x, "location", "city"),
      ...dates(x),
      bullets: toList(
        pick(x, "bullets", "achievements", "responsibilities", "description", "details")
      ),
    };
  });

  const projects = asArray(root.projects ?? root.project).map((raw) => {
    const p = isObj(raw) ? raw : {};
    return {
      name: strAt(p, "name", "title", "项目名"),
      role: strAt(p, "role", "position"),
      period: strAt(p, "period", "date", "dates", "duration", "时间"),
      stack: toList(pick(p, "stack", "tech", "technologies", "techStack", "tools")),
      bullets: toList(
        pick(p, "bullets", "description", "achievements", "details", "highlights")
      ),
    };
  });

  const skills = coerceSkills(root.skills);

  return {
    basics,
    education,
    experience,
    projects,
    skills,
    awards: toList(pick(root, "awards", "certifications", "honors", "奖项")),
  };
}

const SKILL_BUCKETS: Record<keyof CoercedSkills, string[]> = {
  languages: ["languages", "programming", "programmingLanguages", "编程语言"],
  frameworks: ["frameworks", "libraries", "框架"],
  tools: ["tools", "software", "platforms", "工具"],
  other: ["other", "misc", "domains", "其他"],
};

interface CoercedSkills {
  languages: string[];
  frameworks: string[];
  tools: string[];
  other: string[];
}

function coerceSkills(src: unknown): CoercedSkills {
  // A bare list is common; there is no way to bucket it, so keep it visible.
  if (!isObj(src)) {
    return { languages: toList(src), frameworks: [], tools: [], other: [] };
  }

  const out: CoercedSkills = { languages: [], frameworks: [], tools: [], other: [] };
  const claimed = new Set<string>();

  for (const [bucket, aliases] of Object.entries(SKILL_BUCKETS) as [
    keyof CoercedSkills,
    string[],
  ][]) {
    for (const alias of aliases) {
      if (src[alias] !== undefined) {
        out[bucket].push(...toList(src[alias]));
        claimed.add(alias);
      }
    }
  }

  // Models invent bucket names freely ("technical", "quantitative",
  // "certifications"). Dropping those silently loses real skills, so sweep the
  // leftovers into `other` where the user can see and re-file them.
  for (const [key, value] of Object.entries(src)) {
    if (!claimed.has(key)) out.other.push(...toList(value));
  }

  return out;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) return Object.values(v);
  return [];
}

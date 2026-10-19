import { z } from "zod";

/**
 * Field model for a Chinese big-tech style resume (国内大厂标准简历).
 *
 * Section order and emphasis follow what those screens actually rank on:
 * a stated 求职意向, education with school/major/graduation date up top,
 * then internships and projects carried by quantified bullets, then skills.
 * Everything is optional so a half-filled CV still saves.
 */

export const CvBasicsSchema = z.object({
  name: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  location: z.string().default(""),
  links: z.array(z.string()).default([]),
  /** 求职意向 — the single most load-bearing line on a Chinese resume. */
  jobTarget: z.string().default(""),
  summary: z.string().default(""),
});

export const CvEducationSchema = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  major: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  gpa: z.string().default(""),
  highlights: z.array(z.string()).default([]),
});

export const CvExperienceSchema = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});

export const CvProjectSchema = z.object({
  name: z.string().default(""),
  role: z.string().default(""),
  period: z.string().default(""),
  stack: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([]),
});

export const CvSkillsSchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  other: z.array(z.string()).default([]),
});

export const StructuredCvSchema = z.object({
  // .default() on a nested object needs a fully-populated value in zod v4,
  // so build it from the child schema rather than writing the literal twice.
  basics: CvBasicsSchema.default(CvBasicsSchema.parse({})),
  education: z.array(CvEducationSchema).default([]),
  experience: z.array(CvExperienceSchema).default([]),
  projects: z.array(CvProjectSchema).default([]),
  skills: CvSkillsSchema.default(CvSkillsSchema.parse({})),
  awards: z.array(z.string()).default([]),
});

export type CvBasics = z.infer<typeof CvBasicsSchema>;
export type CvEducation = z.infer<typeof CvEducationSchema>;
export type CvExperience = z.infer<typeof CvExperienceSchema>;
export type CvProject = z.infer<typeof CvProjectSchema>;
export type CvSkills = z.infer<typeof CvSkillsSchema>;
export type StructuredCv = z.infer<typeof StructuredCvSchema>;

export const EMPTY_CV: StructuredCv = StructuredCvSchema.parse({});

/** JSON Schema mirror, for constraining the parse call's output. */
export const STRUCTURED_CV_JSON_SCHEMA = {
  type: "object",
  properties: {
    basics: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        location: { type: "string" },
        links: { type: "array", items: { type: "string" } },
        jobTarget: { type: "string" },
        summary: { type: "string" },
      },
      required: ["name", "phone", "email", "location", "links", "jobTarget", "summary"],
      additionalProperties: false,
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          school: { type: "string" },
          degree: { type: "string" },
          major: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          gpa: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
        },
        required: ["school", "degree", "major", "startDate", "endDate", "gpa", "highlights"],
        additionalProperties: false,
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          location: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["company", "title", "location", "startDate", "endDate", "bullets"],
        additionalProperties: false,
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          period: { type: "string" },
          stack: { type: "array", items: { type: "string" } },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["name", "role", "period", "stack", "bullets"],
        additionalProperties: false,
      },
    },
    skills: {
      type: "object",
      properties: {
        languages: { type: "array", items: { type: "string" } },
        frameworks: { type: "array", items: { type: "string" } },
        tools: { type: "array", items: { type: "string" } },
        other: { type: "array", items: { type: "string" } },
      },
      required: ["languages", "frameworks", "tools", "other"],
      additionalProperties: false,
    },
    awards: { type: "array", items: { type: "string" } },
  },
  required: ["basics", "education", "experience", "projects", "skills", "awards"],
  additionalProperties: false,
} as const;

/**
 * Render the structured CV back to Markdown. This is what nanobot stores as
 * memory/CV.md, so the agent reads a clean document rather than raw JSON.
 */
export function renderCvMarkdown(cv: StructuredCv): string {
  const out: string[] = [];
  const { basics } = cv;

  if (basics.name) out.push(`# ${basics.name}`);

  const contact = [basics.location, basics.phone, basics.email, ...basics.links]
    .filter(Boolean)
    .join(" | ");
  if (contact) out.push(contact);

  if (basics.jobTarget) out.push(`\n**求职意向 / Target role:** ${basics.jobTarget}`);
  if (basics.summary) out.push(`\n## 个人简介 / Summary\n\n${basics.summary}`);

  if (cv.education.length) {
    out.push("\n## 教育背景 / Education");
    for (const e of cv.education) {
      const head = [e.school, e.degree, e.major].filter(Boolean).join(" — ");
      const dates = [e.startDate, e.endDate].filter(Boolean).join(" – ");
      out.push(`\n### ${head}${dates ? `  (${dates})` : ""}`);
      if (e.gpa) out.push(`GPA / WAM: ${e.gpa}`);
      for (const h of e.highlights) out.push(`- ${h}`);
    }
  }

  if (cv.experience.length) {
    out.push("\n## 实习/工作经历 / Experience");
    for (const x of cv.experience) {
      const head = [x.company, x.title].filter(Boolean).join(" — ");
      const meta = [x.location, [x.startDate, x.endDate].filter(Boolean).join(" – ")]
        .filter(Boolean)
        .join(", ");
      out.push(`\n### ${head}${meta ? `  (${meta})` : ""}`);
      for (const b of x.bullets) out.push(`- ${b}`);
    }
  }

  if (cv.projects.length) {
    out.push("\n## 项目经历 / Projects");
    for (const p of cv.projects) {
      const head = [p.name, p.role].filter(Boolean).join(" — ");
      out.push(`\n### ${head}${p.period ? `  (${p.period})` : ""}`);
      if (p.stack.length) out.push(`技术栈: ${p.stack.join(", ")}`);
      for (const b of p.bullets) out.push(`- ${b}`);
    }
  }

  const skillLines = [
    ["编程语言", cv.skills.languages],
    ["框架/库", cv.skills.frameworks],
    ["工具", cv.skills.tools],
    ["其他", cv.skills.other],
  ].filter(([, v]) => (v as string[]).length) as [string, string[]][];

  if (skillLines.length) {
    out.push("\n## 技能 / Skills");
    for (const [label, values] of skillLines) {
      out.push(`- **${label}**: ${values.join(", ")}`);
    }
  }

  if (cv.awards.length) {
    out.push("\n## 奖项与证书 / Awards");
    for (const a of cv.awards) out.push(`- ${a}`);
  }

  return out.join("\n").trim();
}

/** True when nothing has been filled in yet — used to decide what to save. */
export function isCvEmpty(cv: StructuredCv): boolean {
  return renderCvMarkdown(cv).length === 0;
}

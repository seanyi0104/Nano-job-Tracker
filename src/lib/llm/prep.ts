import { anthropic, PREP_MODEL } from "./anthropic";
import { recordUsage } from "./usage";
import {
  CompanySnapshotSchema,
  InterviewPrepSchema,
  BehavioralQuestionsSchema,
} from "./schemas";
import type { CompanySnapshot, InterviewPrep, BehavioralQuestions } from "./schemas";

export async function generateCompanySnapshot(
  company: string,
  role: string
,
  userId?: string): Promise<CompanySnapshot | null> {
  const prompt = `Generate a concise company snapshot for a CS student preparing for an interview at ${company} for the role of ${role}.

Focus on information useful for interview preparation:
- culture: A 2-3 sentence description of their engineering culture
- values: 3-5 core company values or principles (especially ones that come up in interviews)
- engineeringFocus: What they're known for technically (1-2 sentences)
- interviewThemes: 3-5 common themes or topics that appear in their interviews

If ${company} is a small or less well-known company, be honest about what you know and provide general guidance appropriate for their industry sector rather than fabricating specific details.

Return a JSON object matching the schema exactly.`;

  return callAndParse(prompt, CompanySnapshotSchema, userId, "prep");
}

export async function generateInterviewPrep(
  company: string,
  role: string
,
  userId?: string): Promise<InterviewPrep | null> {
  const prompt = `Generate interview preparation materials for a CS student interviewing at ${company} for the role of ${role}.

Provide:
- processOverview: A brief 2-3 sentence overview of their typical interview process
- stages: The typical interview stages (e.g., online assessment, phone screen, onsite), each with a name and description of what to expect
- checklist: 5-8 actionable preparation items specific to this company and role

Focus on what's publicly known about their interview process. If ${company} is less well-known, provide sensible defaults for a tech company of their size/type.

Return a JSON object matching the schema exactly.`;

  return callAndParse(prompt, InterviewPrepSchema, userId, "prep");
}

export async function generateBehavioralQuestions(
  company: string,
  role: string
,
  userId?: string): Promise<BehavioralQuestions | null> {
  const prompt = `Generate 6-8 behavioral interview questions that ${company} is likely to ask for a ${role} position.

For each question:
- question: The behavioral question (typically starts with "Tell me about a time...")
- rationale: Why this company would ask this (connect to their values, culture, or interview style)

Tailor questions to ${company}'s known culture and values. For example:
- Amazon → Leadership Principles (Ownership, Customer Obsession, etc.)
- Google → Googleyness, collaboration, handling ambiguity
- Meta → Move Fast, impact-driven
- For less well-known companies, focus on general engineering/teamwork scenarios appropriate for the role level.

Return a JSON object matching the schema exactly.`;

  return callAndParse(prompt, BehavioralQuestionsSchema, userId, "prep");
}

async function callAndParse<T>(
  prompt: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
  userId?: string,
  operation: "prep" = "prep"
): Promise<T | null> {
  try {
    const response = await anthropic.messages.create({
      model: PREP_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    // These three buttons were spending on Sonnet with nothing recording it —
    // a hole in a ledger whose whole promise is that the on-screen figure can
    // be reconciled against the bill. Any call that costs money records here.
    if (userId) {
      await recordUsage({
        userId,
        operation,
        model: PREP_MODEL,
        items: 1,
        usage: response.usage,
      });
    }

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = schema.safeParse(JSON.parse(jsonMatch[0]));
    return parsed.success ? (parsed.data as T) : null;
  } catch (error) {
    console.error("Prep generation failed:", error);
    return null;
  }
}

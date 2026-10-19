import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as { anthropic: Anthropic };

export const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForAnthropic.anthropic = anthropic;

export const CLASSIFY_MODEL = "claude-haiku-4-5";
export const EXTRACT_MODEL = "claude-sonnet-4-6";
export const PREP_MODEL = "claude-sonnet-4-6";

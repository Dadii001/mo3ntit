import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return _client;
}

export const MODEL = "claude-sonnet-4-6";
export const MODEL_FAST = "claude-haiku-4-5-20251001";

export async function extractJson<T>(text: string): Promise<T> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON object in: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

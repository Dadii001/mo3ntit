// Wrapper that exposes simple text/vision generation using the standard
// Anthropic SDK with API key auth. We tried using the Claude Agent SDK with
// CLAUDE_CODE_OAUTH_TOKEN to bill Max plan usage, but the Agent SDK ships a
// 238 MB platform binary that exceeds Vercel's per-function size limit. So
// we're back on direct API key billing — same wrapper signatures, different
// transport underneath.

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./claude";

export const MODEL = "claude-sonnet-4-5";
export const MODEL_FAST = "claude-haiku-4-5";

type GenerateArgs = {
  prompt: string;
  model?: string;
  maxTokens?: number;
};

type ImageInput = {
  base64: string;
  mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

export async function generate(args: GenerateArgs): Promise<string> {
  const resp = await anthropic().messages.create({
    model: args.model ?? MODEL,
    max_tokens: args.maxTokens ?? 1024,
    messages: [{ role: "user", content: args.prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text.trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

export async function generateWithImage(args: {
  prompt: string;
  imageBase64: string;
  mediaType?: ImageInput["mediaType"];
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  return generateWithImages({
    prompt: args.prompt,
    images: [{ base64: args.imageBase64, mediaType: args.mediaType }],
    model: args.model,
    maxTokens: args.maxTokens,
  });
}

export async function generateWithImages(args: {
  prompt: string;
  images: ImageInput[];
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const blocks: Anthropic.ImageBlockParam[] = args.images.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType ?? "image/jpeg",
      data: img.base64,
    },
  }));
  const resp = await anthropic().messages.create({
    model: args.model ?? MODEL,
    max_tokens: args.maxTokens ?? 1024,
    messages: [
      { role: "user", content: [...blocks, { type: "text", text: args.prompt }] },
    ],
  });
  const text = resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

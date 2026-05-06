// Dual-path Claude wrapper.
//
// - Local dev (Windows/Mac/Linux) with CLAUDE_CODE_OAUTH_TOKEN set:
//     Routes through @anthropic-ai/claude-agent-sdk → consumes from your
//     Pro/Max subscription budget. The SDK ships a 238MB platform binary,
//     so it's a devDependency only — never deployed to Vercel.
//
// - Vercel (process.env.VERCEL set) or no OAuth token:
//     Routes through @anthropic-ai/sdk with ANTHROPIC_API_KEY. Same
//     wrapper signatures so callers don't care which path runs.

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./claude";

export const MODEL = "claude-sonnet-4-5";
export const MODEL_FAST = "claude-haiku-4-5";

const useAgentSdk =
  !process.env.VERCEL && !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

// Lazy-load the Agent SDK so production never resolves the import.
type AgentSdk = typeof import("@anthropic-ai/claude-agent-sdk");
let agentSdkPromise: Promise<AgentSdk | null> | null = null;
async function getAgentSdk(): Promise<AgentSdk | null> {
  if (!useAgentSdk) return null;
  if (!agentSdkPromise) {
    agentSdkPromise = (async () => {
      try {
        // devDependency — may not exist at runtime on Vercel; the catch handles it.
        const mod = await import("@anthropic-ai/claude-agent-sdk");
        return mod as AgentSdk;
      } catch {
        return null;
      }
    })();
  }
  return agentSdkPromise;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

type ImageInput = {
  base64: string;
  mediaType?: ImageMediaType;
};

/**
 * Detect an image's MIME type from the first few bytes of its base64-encoded
 * payload. Anthropic's API rejects requests where the declared media_type
 * doesn't match the actual image — clipboard pastes are usually PNG, video
 * frames are usually JPEG, but the caller often doesn't know which.
 */
export function detectImageType(base64: string, fallback: ImageMediaType = "image/png"): ImageMediaType {
  const head = base64.slice(0, 16);
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("R0lGOD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return fallback;
}

// ---- Generate (text only) ----

export async function generate(args: {
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const sdk = await getAgentSdk();
  if (sdk) {
    let result = "";
    for await (const msg of sdk.query({
      prompt: args.prompt,
      options: { model: args.model ?? MODEL, maxTurns: 1, tools: [] },
    })) {
      if (msg.type === "result" && msg.subtype === "success" && "result" in msg) {
        result = msg.result;
      }
    }
    if (result) return result.trim();
    // fall through to API path on empty
  }

  const resp = await anthropic().messages.create({
    model: args.model ?? MODEL,
    max_tokens: args.maxTokens ?? 1024,
    messages: [{ role: "user", content: args.prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text.trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

// ---- Generate with single image ----

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

// ---- Generate with N images ----

export async function generateWithImages(args: {
  prompt: string;
  images: ImageInput[];
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const sdk = await getAgentSdk();
  if (sdk && args.images.length > 0) {
    async function* userMessages() {
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: [
            ...args.images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType ?? detectImageType(img.base64),
                data: img.base64,
              },
            })),
            { type: "text" as const, text: args.prompt },
          ],
        },
        parent_tool_use_id: null,
        session_id: "",
      };
    }

    let result = "";
    for await (const msg of sdk.query({
      prompt: userMessages(),
      options: { model: args.model ?? MODEL, maxTurns: 1, tools: [] },
    })) {
      if (msg.type === "result" && msg.subtype === "success" && "result" in msg) {
        result = msg.result;
      }
    }
    if (result) return result.trim();
  }

  const blocks: Anthropic.ImageBlockParam[] = args.images.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType ?? detectImageType(img.base64),
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

// Thin wrappers around the Claude Agent SDK so the rest of the codebase doesn't
// have to deal with the streaming async iterator. Auth is via env vars:
// - CLAUDE_CODE_OAUTH_TOKEN (Pro/Max subscription) — preferred
// - ANTHROPIC_API_KEY (API billing) — fallback
//
// The SDK picks up whichever is set automatically.

import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export const MODEL = "claude-sonnet-4-5";
export const MODEL_FAST = "claude-haiku-4-5";

const DEFAULT_OPTIONS = {
  // Disable all built-in tools — we want pure inference, not Claude Code
  // touching files.
  tools: [] as string[],
  // Single round-trip for simple generations.
  maxTurns: 1 as number,
};

/**
 * Run a single-turn generation: user prompt → assistant text. No tools.
 */
export async function generate(args: {
  prompt: string;
  model?: string;
}): Promise<string> {
  let result = "";
  for await (const msg of query({
    prompt: args.prompt,
    options: {
      ...DEFAULT_OPTIONS,
      model: args.model ?? MODEL,
    },
  })) {
    if (msg.type === "result" && "result" in msg && msg.subtype === "success") {
      result = msg.result;
    }
  }
  if (!result) throw new Error("Claude returned no result text");
  return result.trim();
}

/**
 * Run a single-turn generation with one image attached. The image is passed as
 * a base64 block in the user message.
 */
export async function generateWithImage(args: {
  prompt: string;
  imageBase64: string;
  mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  model?: string;
}): Promise<string> {
  const mediaType = args.mediaType ?? "image/png";

  async function* messages(): AsyncIterable<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: args.imageBase64,
            },
          },
          { type: "text", text: args.prompt },
        ],
      },
      parent_tool_use_id: null,
      session_id: "",
    };
  }

  let result = "";
  for await (const msg of query({
    prompt: messages(),
    options: {
      ...DEFAULT_OPTIONS,
      model: args.model ?? MODEL,
    },
  })) {
    if (msg.type === "result" && "result" in msg && msg.subtype === "success") {
      result = msg.result;
    }
  }
  if (!result) throw new Error("Claude returned no result text");
  return result.trim();
}

/**
 * Run a single-turn generation with multiple images attached. Same as
 * generateWithImage but accepts an array of base64 frames.
 */
export async function generateWithImages(args: {
  prompt: string;
  images: Array<{ base64: string; mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }>;
  model?: string;
}): Promise<string> {
  if (args.images.length === 0) {
    return generate({ prompt: args.prompt, model: args.model });
  }
  if (args.images.length === 1) {
    return generateWithImage({
      prompt: args.prompt,
      imageBase64: args.images[0].base64,
      mediaType: args.images[0].mediaType,
      model: args.model,
    });
  }

  async function* messages(): AsyncIterable<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [
          ...args.images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType ?? "image/jpeg",
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
  for await (const msg of query({
    prompt: messages(),
    options: {
      ...DEFAULT_OPTIONS,
      model: args.model ?? MODEL,
    },
  })) {
    if (msg.type === "result" && "result" in msg && msg.subtype === "success") {
      result = msg.result;
    }
  }
  if (!result) throw new Error("Claude returned no result text");
  return result.trim();
}

/**
 * Extract a JSON object from a Claude response. Tolerates fenced code blocks
 * and surrounding text.
 */
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

// Re-export query + types for the agent loop, which uses the lower-level API.
export { query };
export type { SDKMessage, SDKUserMessage };

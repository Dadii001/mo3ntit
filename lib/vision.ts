import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractJson, MODEL_FAST } from "./claude";
import type { ImageAnalysis } from "./types";

const SUPPORTED_MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedMedia = (typeof SUPPORTED_MEDIA)[number];

function resolveMediaType(contentType: string | null, url: string): SupportedMedia {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if ((SUPPORTED_MEDIA as readonly string[]).includes(ct)) return ct as SupportedMedia;
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

export async function analyzeProfileImage(imageUrl: string): Promise<ImageAnalysis> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`avatar fetch ${res.status}`);
  const mediaType = resolveMediaType(res.headers.get("content-type"), imageUrl);
  const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");

  const resp = await anthropic().messages.create({
    model: MODEL_FAST,
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Analyze this TikTok profile picture of a music artist. Return JSON only:
{
  "visualStyle": "short description of aesthetic (lo-fi, polished, DIY, ethereal, etc.)",
  "mood": "one-word dominant mood (melancholic, energetic, dreamy, edgy, etc.)",
  "genreHints": ["up to 3 music genres suggested by visual cues"],
  "description": "1-2 sentence description of what's visible and what it signals about the artist"
}`,
          },
        ],
      },
    ],
  });

  const text = resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return extractJson<ImageAnalysis>(text);
}

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractJson, MODEL_FAST } from "./claude";
import type { ImageAnalysis } from "./types";

export async function analyzeProfileImage(imageUrl: string): Promise<ImageAnalysis> {
  const imgBuf = await fetch(imageUrl).then((r) => r.arrayBuffer());
  const base64 = Buffer.from(imgBuf).toString("base64");
  const mediaType = imageUrl.includes(".png") ? "image/png" : "image/jpeg";

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

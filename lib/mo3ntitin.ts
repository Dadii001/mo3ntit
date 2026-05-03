import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractJson, MODEL } from "./claude";
import { getUserInfo, getUserPosts, tiktokProfileUrl, type RawVideoExport } from "./tiktok";

const ffmpegPath = require("ffmpeg-static") as string;

export type CreatorAnalysis = {
  description: string;
  gender: "male" | "female" | "non-binary" | "group" | "unknown";
  styleTags: string[];
  vibe: string;
  contentLanguage: string | null;
};

export type Mo3ntit = {
  handle: string;
  nickname: string;
  profileUrl: string;
  avatarUrl: string | null;
  followers: number;
  totalLikes: number;
  videoCount: number;
  region: string | null;
  bio: string;
  verified: boolean;

  description: string;
  gender: CreatorAnalysis["gender"];
  styleTags: string[];
  vibe: string;
  contentLanguage: string | null;

  videosAnalyzed: number;
};

function parseHandle(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  const match = trimmed.match(/@([A-Za-z0-9._]+)/);
  if (match) return match[1];
  return trimmed.replace(/^@/, "");
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { Referer: "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function probeDurationSec(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-i", file, "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", () => {
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    p.on("error", () => resolve(null));
  });
}

async function extractFrame(videoPath: string, timeSec: number, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(
      ffmpegPath,
      [
        "-y",
        "-ss",
        timeSec.toFixed(2),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-vf",
        "scale='min(640,iw)':-2",
        outPath,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

async function captureFrames(video: RawVideoExport, dir: string, idx: number): Promise<string[]> {
  const url = video.play ?? video.wmplay;
  if (!url) return [];
  const mp4 = join(dir, `v${idx}.mp4`);
  try {
    await downloadToFile(url, mp4);
  } catch {
    return [];
  }
  let dur = (await probeDurationSec(mp4)) ?? video.duration ?? null;
  if (!dur || dur < 1) dur = 5;
  const points = [dur * 0.2, dur * 0.5, dur * 0.8];
  const frames: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const out = join(dir, `v${idx}-f${i}.jpg`);
    if (await extractFrame(mp4, points[i], out)) frames.push(out);
  }
  await rm(mp4, { force: true });
  return frames;
}

async function imagesAsBase64(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      out.push((await readFile(p)).toString("base64"));
    } catch {
      // skip unreadable frame
    }
  }
  return out;
}

async function analyzeWithVision(args: {
  handle: string;
  nickname: string;
  bio: string;
  captions: string[];
  framesB64: string[];
}): Promise<CreatorAnalysis> {
  const imageBlocks: Anthropic.ImageBlockParam[] = args.framesB64.map((b64) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));

  const captionsText = args.captions
    .map((c, i) => `${i + 1}. ${c.trim() || "(no caption)"}`)
    .join("\n");

  const prompt = `You are profiling a TikTok creator so we can match them with the right artists for outreach DMs.

Handle: @${args.handle}
Display name: ${args.nickname}
Bio: ${args.bio || "(no bio)"}

Last few video captions:
${captionsText || "(none)"}

Below are screenshots from their recent videos (3 frames per video, in order). Look at what the person is doing, the vibe, the visual style, the energy.

Return JSON only, no prose:
{
  "description": "2-3 sentences describing this creator's content and style — what they post, their on-camera energy, who they'd connect with. Should read like a quick pitch a teammate could skim.",
  "gender": "male | female | non-binary | group | unknown",
  "styleTags": ["3-6 short tags like 'lifestyle', 'comedy', 'fashion', 'street', 'music-reactor', 'storytime'"],
  "vibe": "one short phrase capturing the energy (e.g. 'chill aesthetic', 'high-energy chaos', 'soft girl', 'gym bro')",
  "contentLanguage": "primary spoken/written language code like 'en', 'fr', 'ar', 'es', or null if unclear"
}`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: prompt }],
      },
    ],
  });

  const text = resp.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return extractJson<CreatorAnalysis>(text);
}

export async function analyzeCreator(handleInput: string): Promise<Mo3ntit> {
  const handle = parseHandle(handleInput);
  const profile = await getUserInfo(handle);
  const posts = await getUserPosts(profile.uid, 5);

  const dir = join(tmpdir(), `mo3-${handle}-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const allFrames: string[] = [];
  const captions: string[] = [];
  try {
    for (let i = 0; i < posts.length; i++) {
      const v = posts[i];
      const frames = await captureFrames(v, dir, i);
      allFrames.push(...frames);
      captions.push(v.title ?? v.desc ?? v.content_desc ?? "");
    }

    if (allFrames.length === 0) {
      throw new Error(`no frames captured for @${handle}`);
    }

    const framesB64 = await imagesAsBase64(allFrames);
    const analysis = await analyzeWithVision({
      handle,
      nickname: profile.nickname,
      bio: profile.signature,
      captions,
      framesB64,
    });

    return {
      handle,
      nickname: profile.nickname,
      profileUrl: tiktokProfileUrl(handle),
      avatarUrl: profile.avatarLarger || null,
      followers: profile.followerCount,
      totalLikes: profile.heartCount,
      videoCount: profile.videoCount,
      region: profile.region,
      bio: profile.signature,
      verified: profile.verified,

      description: analysis.description,
      gender: analysis.gender,
      styleTags: analysis.styleTags,
      vibe: analysis.vibe,
      contentLanguage: analysis.contentLanguage,

      videosAnalyzed: posts.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { env } from "./env";

const ffmpegPath = require("ffmpeg-static") as string;

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { Referer: "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))));
  });
}

async function workDir(): Promise<string> {
  const dir = join(tmpdir(), `iaf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function decodePcm(mp3Path: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const pcmPath = mp3Path.replace(/\.mp3$/, ".pcm");
  const sampleRate = 22050;
  await runFfmpeg([
    "-y",
    "-i", mp3Path,
    "-f", "f32le",
    "-ac", "1",
    "-ar", String(sampleRate),
    pcmPath,
  ]);
  const buf = await readFile(pcmPath);
  await unlink(pcmPath).catch(() => {});
  const samples = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);
  return { samples, sampleRate };
}

async function detectBpm(samples: Float32Array, sampleRate: number): Promise<number | null> {
  try {
    const MusicTempo = require("music-tempo");
    const arr = Array.from(samples);
    const mt = new MusicTempo(arr, { sampleRate });
    const bpm = Math.round(parseFloat(mt.tempo));
    return Number.isFinite(bpm) && bpm > 40 && bpm < 220 ? bpm : null;
  } catch {
    return null;
  }
}

async function durationSec(mp3Path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-i", mp3Path, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", () => {
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      resolve(Math.round(sec));
    });
    p.on("error", () => resolve(null));
  });
}

async function transcribeWhisper(mp3Path: string): Promise<{ text: string; language: string } | null> {
  const key = env.openaiApiKey();
  if (!key) return null;
  const buf = await readFile(mp3Path);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), "song.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { text: string; language: string };
  return { text: body.text, language: body.language };
}

export async function analyzeAudio(url: string): Promise<{
  bpm: number | null;
  durationSec: number | null;
  transcript: string | null;
  language: string | null;
}> {
  const dir = await workDir();
  const mp3Path = join(dir, "song.mp3");
  try {
    await download(url, mp3Path);
    const [dur, decoded, whisper] = await Promise.all([
      durationSec(mp3Path),
      decodePcm(mp3Path).catch(() => null),
      transcribeWhisper(mp3Path).catch(() => null),
    ]);
    const bpm = decoded ? await detectBpm(decoded.samples, decoded.sampleRate) : null;
    return {
      bpm,
      durationSec: dur,
      transcript: whisper?.text ?? null,
      language: whisper?.language ?? null,
    };
  } finally {
    await unlink(mp3Path).catch(() => {});
  }
}

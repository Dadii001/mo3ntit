import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractJson, MODEL_FAST, MODEL } from "./claude";
import type { ArtistProfile, BioAnalysis, ImageAnalysis, SongAnalysis, TikTokAuthor, TikTokVideo } from "./types";

export async function analyzeBio(bio: string, nickname: string): Promise<BioAnalysis> {
  const prompt = `Extract structured info from this TikTok bio of an artist named "${nickname}":

---
${bio || "(empty bio)"}
---

Return JSON only:
{
  "name": "artist's real name if mentioned, else null",
  "location": "city/country if mentioned, else null",
  "genres": ["music genres mentioned or strongly implied"],
  "instruments": ["instruments mentioned"],
  "contactLinks": ["any URLs, emails, or other-platform handles found in bio"],
  "summary": "2-sentence summary of who this artist presents themselves as"
}`;
  const resp = await anthropic().messages.create({
    model: MODEL_FAST,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text;
  return extractJson<BioAnalysis>(text);
}

export async function buildArtistBrief(args: {
  author: TikTokAuthor;
  video: TikTokVideo;
  image: ImageAnalysis;
  bioAnalysis: BioAnalysis;
  song: SongAnalysis;
}): Promise<string> {
  const { author, video, image, bioAnalysis, song } = args;
  const prompt = `Write a tight 3-4 sentence brief on this indie artist for a music label's outreach team.

Handle: @${author.uniqueId} — ${author.nickname}
Followers: ${author.followerCount.toLocaleString()} | Likes: ${author.heartCount.toLocaleString()} | Videos: ${author.videoCount}
Region: ${author.region ?? "unknown"} | Verified: ${author.verified}
Bio: ${author.signature || "(empty)"}
Bio analysis: ${JSON.stringify(bioAnalysis)}
Profile image: ${image.description} (mood: ${image.mood}, style: ${image.visualStyle}, genre hints: ${image.genreHints.join(", ")})
Top video: "${video.desc}" — ${video.stats.plays.toLocaleString()} plays, ${video.stats.likes.toLocaleString()} likes
Song: "${video.musicTitle ?? "original"}" by ${video.musicAuthor ?? author.nickname} — ${song.bpm ? `${song.bpm} BPM` : "tempo unknown"}
Song brief: ${song.brief}

Return the brief only, no preamble.`;
  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  return (resp.content[0] as Anthropic.TextBlock).text.trim();
}

export async function buildSongBrief(args: {
  musicTitle: string | null;
  musicAuthor: string | null;
  bpm: number | null;
  durationSec: number | null;
  transcript: string | null;
  videoDesc: string;
}): Promise<string> {
  const prompt = `Write a 2-3 sentence brief of this song for a music label's A&R team.

Title: ${args.musicTitle ?? "(original sound)"}
Credited author: ${args.musicAuthor ?? "(unknown)"}
Tempo: ${args.bpm ? `${args.bpm} BPM` : "unknown"}
Duration: ${args.durationSec ? `${args.durationSec}s` : "unknown"}
Video caption: "${args.videoDesc}"
Lyrics transcript: ${args.transcript ? args.transcript.slice(0, 2000) : "(not available)"}

Cover: energy, genre cues, lyrical theme if known, production quality signals. Return brief only.`;
  const resp = await anthropic().messages.create({
    model: MODEL_FAST,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  return (resp.content[0] as Anthropic.TextBlock).text.trim();
}

export async function buildCustomDm(artist: Omit<ArtistProfile, "artistBrief" | "customDm">): Promise<string> {
  const prompt = `Write a warm, specific outreach DM to this indie artist from a music label scout. Max 4 short sentences. No emojis, no "hey girl/bro", no template feel. Reference one concrete detail from their profile or song.

Artist: ${artist.nickname} (@${artist.username})
Bio: ${artist.bio || "(empty)"}
Followers: ${artist.followers.toLocaleString()}
Genres hinted: ${[...artist.bioAnalysis.genres, ...artist.image.genreHints].join(", ") || "unclear"}
Song: "${artist.topVideo.musicTitle ?? "original"}" — ${artist.song.brief}
Video caption: "${artist.topVideo.desc}"
Profile image: ${artist.image.description}

Return the DM text only.`;
  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  return (resp.content[0] as Anthropic.TextBlock).text.trim();
}

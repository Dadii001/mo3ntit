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
Signature song: "${song.title ?? "untitled original"}" by ${song.author ?? author.nickname} — ${song.isOriginal ? "likely original" : "unconfirmed"}, used in ${song.useCount} recent posts, ${song.bpm ? `${song.bpm} BPM` : "tempo unknown"}
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
  isOriginal: boolean;
  useCount: number;
  totalPlays: number;
  recentVideoCount: number;
}): Promise<string> {
  const tempoBand = args.bpm
    ? args.bpm < 80
      ? "slow / downtempo"
      : args.bpm < 110
      ? "mid-tempo"
      : args.bpm < 140
      ? "upbeat"
      : "high-energy / dance"
    : "unknown";

  const prompt = `Write a detailed 4-5 sentence A&R brief on this song. Cover: (1) genre + sub-genre cues, (2) tempo/energy + production polish signals, (3) lyrical theme and mood from the transcript, (4) vocal / instrumental standout traits if detectable, (5) commercial positioning. Be specific — no filler, no hedging about "without more data".

Title: ${args.musicTitle ?? "(untitled original sound)"}
Credited artist: ${args.musicAuthor ?? "(unknown)"}
Status: ${args.isOriginal ? "Confirmed original by this artist" : "Usage match unclear — may be cover, collab, or external track"}
Signature usage: this artist used this track in ${args.useCount} of their last ${args.recentVideoCount} posts (total ${args.totalPlays.toLocaleString()} plays on those posts)
Tempo: ${args.bpm ? `${args.bpm} BPM (${tempoBand})` : "unknown"}
Duration: ${args.durationSec ? `${args.durationSec}s` : "unknown"}
Most-liked caption with this song: "${args.videoDesc}"
Lyrics transcript:
"""
${args.transcript ? args.transcript.slice(0, 3000) : "(no transcript — audio-only instrumental or transcription unavailable)"}
"""

Return the brief only, no preamble, no bullet points — prose.`;
  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 500,
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
Signature song: "${artist.song.title ?? "untitled original"}" (${artist.song.isOriginal ? "likely original" : "unconfirmed origin"}, used in ${artist.song.useCount} recent posts) — ${artist.song.brief}
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

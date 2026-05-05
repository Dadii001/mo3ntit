import { extractJson, generate, MODEL, MODEL_FAST } from "./claude-agent";
import type { BioAnalysis, ImageAnalysis, SongAnalysis, TikTokAuthor, TikTokVideo } from "./types";

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
  const text = await generate({ prompt, model: MODEL_FAST });
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
Signature song: "${song.title ?? "untitled original"}" by ${song.author ?? author.nickname} — ${song.isOriginal ? "likely original" : "unconfirmed"}, used in ${song.useCount} recent posts
Song brief: ${song.brief}

Return the brief only, no preamble.`;
  return generate({ prompt, model: MODEL });
}

function isMeaninglessSongTitle(title: string | null): boolean {
  if (!title) return true;
  const t = title.toLowerCase().trim();
  return (
    t === "original sound" ||
    t.startsWith("original sound -") ||
    t.startsWith("original sound by") ||
    t.startsWith("original sound ·") ||
    /^original\s+sound\s*[-–—·|]/.test(t)
  );
}

export async function buildSongBrief(args: {
  musicTitle: string | null;
  musicAuthor: string | null;
  durationSec: number | null;
  transcript: string | null;
  videoDesc: string;
  isOriginal: boolean;
  useCount: number;
  totalPlays: number;
  recentVideoCount: number;
}): Promise<string> {
  const untitled = isMeaninglessSongTitle(args.musicTitle);
  const titleLine = untitled
    ? "Title: (none — TikTok's default 'original sound' placeholder. DO NOT reference the title. The song has no known name.)"
    : `Title: ${args.musicTitle}`;

  const prompt = `Write a detailed 4-5 sentence A&R brief on this song. Cover: (1) genre + sub-genre cues, (2) energy and production polish signals, (3) lyrical theme and mood from the transcript, (4) vocal / instrumental standout traits if detectable, (5) commercial positioning. Be specific — no filler, no hedging about "without more data".

${titleLine}
Credited artist: ${args.musicAuthor ?? "(unknown)"}
Status: ${args.isOriginal ? "Confirmed original by this artist" : "Usage match unclear — may be cover, collab, or external track"}
Signature usage: this artist used this track in ${args.useCount} of their last ${args.recentVideoCount} posts (total ${args.totalPlays.toLocaleString()} plays on those posts)
Duration: ${args.durationSec ? `${args.durationSec}s` : "unknown"}
Most-liked caption with this song: "${args.videoDesc}"
Lyrics transcript:
"""
${args.transcript ? args.transcript.slice(0, 3000) : "(no transcript — audio-only instrumental or transcription unavailable)"}
"""

${untitled ? "IMPORTANT: The song title is just TikTok's 'original sound' placeholder — NEVER mention or reference the title in the brief. Focus on what the transcript and usage reveal." : ""}

Return the brief only, no preamble, no bullet points — prose.`;
  return generate({ prompt, model: MODEL });
}

export async function buildCustomDm(args: { artistBrief: string; songBrief: string }): Promise<string> {
  const prompt = `Write a DM to an indie artist that sounds like a real person who genuinely stumbled onto their stuff.

RULES (non-negotiable):
- ONE sentence. Two only if the second is a 4-word kicker. Under 25 words total. Hard cap.
- Natural + a little funny. A dry observation, a self-aware aside, a light joke — NOT try-hard, NOT corporate, NOT "your vibe is immaculate" energy. Make them smirk, not roll their eyes.
- Use the ARTIST BRIEF to calibrate tone (match their energy — if the artist is moody, don't be chipper; if they're chaotic, lean in).
- Use the SONG BRIEF to pick ONE specific detail to riff on — something only someone who actually listened would notice.
- NEVER reference the song's title or name. If the song has no real name ("original sound"), never mention one. Riff on the sound, a lyric, the mood — not a title.
- End with a casual question or hook that's low-effort to answer. Or end with an observation that invites a reply. Avoid "hop on a call", "let's chat", "LFG".
- NO emojis. NO "hey"/"hi" openers. NO generic compliments ("amazing/incredible/dope/fire/slaps"). NO exclamation marks unless sarcastic.
- Don't pitch anything. Don't mention labels, signing, contracts, or yourself as a scout. Just be a human who liked the song.

ARTIST BRIEF:
${args.artistBrief}

SONG BRIEF:
${args.songBrief}

Return the DM text only, nothing else.`;
  return generate({ prompt, model: MODEL });
}

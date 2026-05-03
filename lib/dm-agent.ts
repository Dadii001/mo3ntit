import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, extractJson, MODEL, MODEL_FAST } from "./claude";
import {
  insertMinimalArtist,
  uploadAvatar,
  type ArtistRow,
  type DmPromptRow,
  type Mo3ntitRow,
} from "./supabase";
import { getUserInfo, tiktokProfileUrl } from "./tiktok";

export type SelectedMo3ntit = {
  mo3ntitId: string;
  reason: string;
};

export async function selectBestMo3ntit(
  artist: ArtistRow,
  candidates: Mo3ntitRow[],
): Promise<SelectedMo3ntit> {
  if (candidates.length === 0) throw new Error("no mo3ntitin available");
  if (candidates.length === 1) {
    return { mo3ntitId: candidates[0].id, reason: "only one available" };
  }
  return selectBestMo3ntitFromList(artist, candidates);
}

// Filters to the mo3ntit with the lowest current assignment count (rotation), then
// asks the LLM to pick the best fit among those. Guarantees every mo3ntit gets one
// before any gets two.
export async function selectMo3ntitWithRotation(args: {
  artist: ArtistRow;
  mo3ntitin: Mo3ntitRow[];
  counts: Map<string, number>;
}): Promise<SelectedMo3ntit> {
  const { artist, mo3ntitin, counts } = args;
  if (mo3ntitin.length === 0) throw new Error("no mo3ntitin available");

  const min = Math.min(...mo3ntitin.map((m) => counts.get(m.id) ?? 0));
  const eligible = mo3ntitin.filter((m) => (counts.get(m.id) ?? 0) === min);

  if (eligible.length === 1) {
    return { mo3ntitId: eligible[0].id, reason: `rotation pick (only one at count ${min})` };
  }
  const sel = await selectBestMo3ntitFromList(artist, eligible);
  return {
    mo3ntitId: sel.mo3ntitId,
    reason: `rotation pick from ${eligible.length} tied at count ${min}: ${sel.reason}`,
  };
}

async function selectBestMo3ntitFromList(
  artist: ArtistRow,
  candidates: Mo3ntitRow[],
): Promise<SelectedMo3ntit> {

  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.id} @${c.handle} — ${c.gender ?? "unknown"} | vibe: ${c.vibe ?? "—"} | tags: ${(c.style_tags ?? []).join(", ")}\n   ${c.description ?? ""}`,
    )
    .join("\n\n");

  const prompt = `You are matching one of our roster TikTok creators (mo3ntitin) to send a DM to an indie artist. Pick the single best fit.

ARTIST
@${artist.account} — ${artist.nickname}
Brief: ${artist.artist_brief ?? "(none)"}
Song brief: ${artist.song_brief ?? "(none)"}
Region: ${artist.region ?? "unknown"} | Language: ${artist.song_language ?? "unknown"}

CANDIDATES (${candidates.length})
${list}

Pick the candidate whose vibe, gender, and content style would feel most natural reaching out to this artist about this song. Return JSON only:
{ "mo3ntitId": "<the id>", "reason": "<one short sentence why this match>" }`;

  const resp = await anthropic().messages.create({
    model: MODEL_FAST,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text;
  const out = await extractJson<SelectedMo3ntit>(text);
  if (!candidates.some((c) => c.id === out.mo3ntitId)) {
    return { mo3ntitId: candidates[0].id, reason: "fallback (LLM returned unknown id)" };
  }
  return out;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

export async function generateFirstDm(args: {
  artist: ArtistRow;
  mo3ntit: Mo3ntitRow;
  prompt: DmPromptRow;
}): Promise<string> {
  const { artist, mo3ntit, prompt } = args;

  const filled = fillTemplate(prompt.template, {
    artist_nickname: artist.nickname ?? artist.account,
    artist_handle: artist.account,
    artist_brief: artist.artist_brief ?? "",
    song_brief: artist.song_brief ?? "",
    song_name: artist.song_name ?? "",
    song_language: artist.song_language ?? "",
    mo3ntit_handle: mo3ntit.handle,
    mo3ntit_nickname: mo3ntit.nickname ?? mo3ntit.handle,
    mo3ntit_description: mo3ntit.description ?? "",
    mo3ntit_vibe: mo3ntit.vibe ?? "",
    mo3ntit_gender: mo3ntit.gender ?? "",
  });

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `${filled}\n\nReturn only the DM text. No quotes, no preamble, no explanation. Plain text only.`,
      },
    ],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text.trim();
  return stripQuotes(text);
}

function stripQuotes(s: string): string {
  return s.replace(/^["'`]+|["'`]+$/g, "").trim();
}

export type InboxAnalysis = {
  unreadCount: number;
  threads: Array<{
    handle: string | null;
    nickname: string | null;
    snippet: string;
  }>;
  notes: string | null;
};

export async function analyzeInboxScreenshot(imageBase64: string): Promise<InboxAnalysis> {
  const block: Anthropic.ImageBlockParam = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: imageBase64 },
  };

  const prompt = `This is a screenshot of a TikTok inbox. Identify any UNREAD message threads.

Unread indicators: bold text, red dot/badge, unread counter, "New" tag.

Return JSON only:
{
  "unreadCount": <number of unread threads visible>,
  "threads": [
    { "handle": "<@handle if visible, else null>", "nickname": "<display name if visible, else null>", "snippet": "<the visible message preview text>" }
  ],
  "notes": "<one short note if anything is ambiguous, else null>"
}

Only include threads that look UNREAD. Empty array if there are no unread threads.`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text;
  return extractJson<InboxAnalysis>(text);
}

export type ConversationAnalysis = {
  artistHandle: string | null;
  artistNickname: string | null;
  outbound: string[];
  inbound: string[];
  lastDirection: "in" | "out" | null;
  notes: string | null;
};

export async function analyzeConversationScreenshot(
  imageBase64: string,
): Promise<ConversationAnalysis> {
  const block: Anthropic.ImageBlockParam = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: imageBase64 },
  };

  const prompt = `This is a screenshot of a TikTok DM conversation. Extract the messages in order.

The OUTBOUND side is "us" (the mo3ntit account, usually right-aligned). The INBOUND side is the other artist (usually left-aligned).

Return JSON only:
{
  "artistHandle": "<@handle of the other person if visible, else null>",
  "artistNickname": "<their display name if visible, else null>",
  "outbound": ["each outbound message in chronological order"],
  "inbound": ["each inbound message in chronological order"],
  "lastDirection": "in | out | null",
  "notes": "<short note about anything unclear, else null>"
}`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text;
  return extractJson<ConversationAnalysis>(text);
}

export async function draftReply(args: {
  artist: ArtistRow;
  mo3ntit: Mo3ntitRow | null;
  history: Array<{ direction: "in" | "out"; body: string }>;
  latestInbound: string;
}): Promise<string> {
  const { artist, mo3ntit, history, latestInbound } = args;

  const transcript = history
    .map((m) => `${m.direction === "out" ? "US" : "ARTIST"}: ${m.body}`)
    .join("\n");

  const prompt = `Draft a short, natural reply in the same DM thread. We are ${mo3ntit ? `@${mo3ntit.handle}` : "a TikTok creator"}, reaching out to indie artist @${artist.account} (${artist.nickname}).

Artist brief: ${artist.artist_brief ?? "(none)"}
Song brief: ${artist.song_brief ?? "(none)"}
${mo3ntit?.description ? `Our (the sender's) creator style: ${mo3ntit.description}` : ""}

Conversation so far:
${transcript || "(no prior messages logged)"}

Their latest message:
"${latestInbound}"

Write the reply. Keep it under 25 words, one sentence, casual, human, no emojis unless they used one first, no salesy language, match their energy. Don't mention the song title. Return only the reply text. No quotes, no preamble.`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text.trim();
  return stripQuotes(text);
}

export async function createArtistFromHandle(rawHandle: string): Promise<ArtistRow> {
  const handle = rawHandle.replace(/^@/, "").trim();
  if (!handle) throw new Error("empty handle");

  const profile = await getUserInfo(handle);

  let avatarUrl: string | null = profile.avatarLarger || null;
  if (avatarUrl) {
    try {
      const res = await fetch(avatarUrl, {
        headers: { Referer: "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        const ext = ct.includes("png") ? "png" : "jpg";
        const url = await uploadAvatar({
          key: `artist/${handle.toLowerCase()}.${ext}`,
          buffer: buf,
          contentType: ct,
        });
        avatarUrl = `${url}?v=${Date.now()}`;
      }
    } catch {
      // keep the TikTok URL; better than nothing
    }
  }

  return insertMinimalArtist({
    account: handle,
    nickname: profile.nickname || handle,
    tiktok_profile: tiktokProfileUrl(handle),
    avatar_url: avatarUrl,
    followers: profile.followerCount,
    total_likes: profile.heartCount,
    video_count: profile.videoCount,
    region: profile.region,
    bio: profile.signature || null,
    verified: profile.verified,
  });
}

export const DEFAULT_PROMPT_TEMPLATE = `You are {{mo3ntit_nickname}} (@{{mo3ntit_handle}}), a TikTok creator. Write the FIRST DM to indie artist @{{artist_handle}} ({{artist_nickname}}).

Their vibe: {{artist_brief}}
Their song: {{song_brief}}
Your own style: {{mo3ntit_description}}

Rules:
- One sentence, max 25 words.
- Sound like a real person texting, not a brand.
- Riff on ONE specific detail from their song or vibe — don't list everything.
- No emojis. No "love your stuff" cliches. No mention of the song title.
- Match their language ({{song_language}}) if not English.
- Don't pitch anything yet. Just open the door.`;

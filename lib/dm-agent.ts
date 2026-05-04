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

STRICT RULE — a thread is UNREAD ONLY if it has a visible RED DOT or RED CIRCLE/BADGE next to or on top of the avatar / on the right side of the row. That red mark is the ONLY signal that counts.

Things that DO NOT mean unread on their own:
- bold-looking text
- recent timestamps
- the thread being at the top of the list
- text being slightly brighter than other rows

If you do not see an actual red dot/badge on a row, that row is READ. Do not guess. Do not infer.

Return JSON only:
{
  "unreadCount": <integer — count ONLY rows with a red dot/badge>,
  "threads": [
    { "handle": "<@handle if visible, else null>", "nickname": "<display name if visible, else null>", "snippet": "<the visible message preview text>" }
  ],
  "notes": "<short note ONLY if you saw something ambiguous, else null>"
}

If there are zero red dots in the screenshot, return unreadCount: 0 and an empty threads array. Do not include any read threads in the threads array.`;

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

export const FUNNEL_STAGES = ["hook", "rapport", "qualify", "pitch", "closing"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  hook: "Hook",
  rapport: "Rapport",
  qualify: "Qualify",
  pitch: "Pitch",
  closing: "Closing",
};

const FUNNEL_DESCRIPTION = `You are running a 5-stage conversion funnel via TikTok DMs to indie artists. Every reply should subtly move the conversation toward the next stage. The artist must FEEL: special, talented, real potential to go viral — they just need the right promo. Voice: human, casual, peer-to-peer. NEVER salesy or corporate. Keep messages short — one idea, one sentence usually. No emojis unless they used one first. Match their energy.

Stage 1 — HOOK (already done; this was the first DM).

Stage 2 — RAPPORT
  Goal: get them comfortable, react to what they said, find common ground.
  Do: react warmly to whatever they shared. Drop a small genuine compliment about their music/vibe ("this kind of writing is rare", "your tone is unreal", etc.).
  Don't: ask about promo yet. Don't pitch anything.

Stage 3 — QUALIFY
  Goal: find out if they've worked with creators / done promo before.
  Do: slip a casual question in like a peer asking — "btw have you ever had your stuff pushed by creators?" / "ever done any promo with tiktokers before?".
  Don't: phrase it like a survey or sales discovery. Make it feel like curiosity.

Stage 4 — PITCH
  Goal: plant the viral idea. Tell them their song has the right ingredients to blow up — they just need the right push. Offer a SPECIFIC trend angle they could ride (something concrete that uses their song to start a sound-trend on TikTok, e.g. a recurring visual gag, a transition, a hook moment).
  Do: be excited and creative, frame it as a fun creative move not a sales pitch. Make them feel chosen.
  Don't: mention price, terms, or "offer". Just the idea.

Stage 5 — CLOSING
  Goal: convert their interest into a yes-go-deeper moment.
  Do: when they're showing real interest, get them to confirm they want to do it. Something like "want me to put something together for you?" or "should i draft what we'd actually do?".
  Don't: send the offer link yourself — a human will do that. Just bring them right to the edge.

When you read their latest reply, decide:
- Are they ready for the next stage's move? Then advance.
- Still warming up? Stay on the current stage.
- They went cold or off-topic? Stay, gently re-engage.
- They asked a direct question? Answer it briefly first, then nudge.

You can also DOWN-shift if needed (e.g. they got hesitant — pull back to rapport).`;

export type DraftReplyResult = {
  messages: string[];
  stageAfter: FunnelStage;
  rationale: string;
};

export async function draftReply(args: {
  artist: ArtistRow;
  mo3ntit: Mo3ntitRow | null;
  history: Array<{ direction: "in" | "out"; body: string }>;
  latestInbound: string;
  stage: FunnelStage;
}): Promise<DraftReplyResult> {
  const { artist, mo3ntit, history, latestInbound, stage } = args;

  const transcript = history
    .map((m) => `${m.direction === "out" ? "US" : "ARTIST"}: ${m.body}`)
    .join("\n");

  const prompt = `${FUNNEL_DESCRIPTION}

CONTEXT
We are ${mo3ntit ? `@${mo3ntit.handle}` : "a TikTok creator"}, talking to indie artist @${artist.account} (${artist.nickname}).
Artist brief: ${artist.artist_brief ?? "(none)"}
Song brief: ${artist.song_brief ?? "(none)"}
${mo3ntit?.description ? `Our (sender) creator style: ${mo3ntit.description}` : ""}

CURRENT STAGE: ${stage} (${FUNNEL_STAGE_LABELS[stage]})

CONVERSATION SO FAR:
${transcript || "(no prior messages logged)"}

THEIR LATEST MESSAGE:
"${latestInbound}"

Draft the next reply.

Hard rules:
- Plain text, no emojis unless they used one first.
- Don't quote their words back. Don't say "love your stuff" / "big fan" / "saw your video". Don't mention the song title.
- Don't pitch anything in stage rapport/qualify. Only in pitch/closing.

CADENCE — you can split the reply into 1, 2, or 3 short back-to-back messages if a natural human texting rhythm would do so (e.g. a quick hook, then a follow-up thought, then a question). MOST OF THE TIME use ONE message. Only split when:
- Each chunk would stand on its own as a complete short thought.
- The rhythm reads like how a person actually texts, not one message arbitrarily chopped.
- The split adds real warmth (e.g. a "btw…" beat, a clarifying example).

Each individual message: max 18 words.

Return JSON only:
{
  "messages": ["msg 1", "msg 2 (optional)", "msg 3 (optional)"],
  "stageAfter": "hook | rapport | qualify | pitch | closing",
  "rationale": "<one short sentence on why this stage is right and (if you split) why splitting feels natural>"
}`;

  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content[0] as Anthropic.TextBlock).text;
  const parsed = await extractJson<{
    messages?: string[];
    reply?: string;
    stageAfter: FunnelStage;
    rationale: string;
  }>(text);

  if (!FUNNEL_STAGES.includes(parsed.stageAfter)) {
    parsed.stageAfter = stage;
  }

  // Accept either { messages: [...] } (preferred) or { reply: "..." } (legacy fallback).
  let raw: string[] = Array.isArray(parsed.messages)
    ? parsed.messages
    : parsed.reply
      ? [parsed.reply]
      : [];
  raw = raw
    .map((m) => stripQuotes((m ?? "").trim()))
    .filter((m) => m.length > 0)
    .slice(0, 3);

  return {
    messages: raw,
    stageAfter: parsed.stageAfter,
    rationale: parsed.rationale ?? "",
  };
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

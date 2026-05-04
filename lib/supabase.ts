import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Mo3ntit } from "./mo3ntitin";
import type { ArtistProfile } from "./types";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export function isSupabaseConfigured(): boolean {
  return getClient() !== null;
}

export async function saveArtistToSupabase(
  artist: ArtistProfile,
  mondayId: string | null,
): Promise<{ id: string } | null> {
  const c = getClient();
  if (!c) return null;

  const row = {
    account: artist.username.toLowerCase(),
    nickname: artist.nickname,
    tiktok_profile: artist.profileUrl,
    avatar_url: artist.avatarUrl,
    followers: artist.followers,
    total_likes: artist.totalLikes,
    video_count: artist.videoCount,
    region: artist.region,
    bio: artist.bio,
    verified: artist.verified,

    song_name: artist.song.title,
    song_author: artist.song.author,
    song_link: artist.song.videoUrl ?? artist.song.url,
    song_video_url: artist.song.videoUrl,
    song_music_id: artist.song.musicId,
    song_brief: artist.song.brief,
    song_transcript: artist.song.transcript,
    song_language: artist.song.language,
    song_duration_sec: artist.song.durationSec,
    song_is_original: artist.song.isOriginal,
    song_use_count: artist.song.useCount,

    artist_brief: artist.artistBrief,
    custom_dm: artist.customDm,

    image_analysis: artist.image as unknown as Record<string, unknown>,
    bio_analysis: artist.bioAnalysis as unknown as Record<string, unknown>,

    monday_id: mondayId,
    sent_date: new Date().toISOString().split("T")[0],
  };

  const { data, error } = await c
    .from("artists")
    .upsert(row, { onConflict: "account" })
    .select("id")
    .single();

  if (error) throw new Error(`supabase upsert: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export async function saveMo3ntitToSupabase(c: Mo3ntit): Promise<{ id: string } | null> {
  const client = getClient();
  if (!client) return null;

  let storedAvatar: string | null = c.avatarUrl;
  if (c.avatarUrl) {
    try {
      const res = await fetch(c.avatarUrl, {
        headers: { Referer: "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        const ext = ct.includes("png") ? "png" : "jpg";
        const url = await uploadAvatar({
          key: `mo3ntit/${c.handle.toLowerCase()}.${ext}`,
          buffer: buf,
          contentType: ct,
        });
        storedAvatar = `${url}?v=${Date.now()}`;
      }
    } catch {
      // fall back to TikTok URL — better than nothing
    }
  }

  const row = {
    handle: c.handle.toLowerCase(),
    nickname: c.nickname,
    profile_url: c.profileUrl,
    avatar_url: storedAvatar,
    followers: c.followers,
    total_likes: c.totalLikes,
    video_count: c.videoCount,
    region: c.region,
    bio: c.bio,
    verified: c.verified,
    description: c.description,
    gender: c.gender,
    style_tags: c.styleTags,
    vibe: c.vibe,
    content_language: c.contentLanguage,
    videos_analyzed: c.videosAnalyzed,
    last_analyzed_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("mo3ntitin")
    .upsert(row, { onConflict: "handle" })
    .select("id")
    .single();

  if (error) throw new Error(`supabase mo3ntitin upsert: ${error.message}`);
  return { id: (data as { id: string }).id };
}

export type Mo3ntitRow = {
  id: string;
  handle: string;
  nickname: string | null;
  profile_url: string;
  avatar_url: string | null;
  followers: number | null;
  total_likes: number | null;
  video_count: number | null;
  region: string | null;
  bio: string | null;
  verified: boolean;
  description: string | null;
  gender: string | null;
  style_tags: string[] | null;
  vibe: string | null;
  content_language: string | null;
  videos_analyzed: number | null;
  last_analyzed_at: string | null;
  created_at: string;
};

export async function listMo3ntitin(): Promise<Mo3ntitRow[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("mo3ntitin")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`supabase mo3ntitin list: ${error.message}`);
  return (data ?? []) as Mo3ntitRow[];
}

export async function listSupabaseAccounts(): Promise<Set<string>> {
  const c = getClient();
  if (!c) return new Set();
  const { data, error } = await c.from("artists").select("account").limit(2000);
  if (error) return new Set();
  return new Set((data ?? []).map((r: { account: string }) => r.account.toLowerCase()));
}

// --- DM agent: artists, conversations, prompts ---

export type ArtistRow = {
  id: string;
  account: string;
  nickname: string;
  tiktok_profile: string;
  avatar_url: string | null;
  followers: number | null;
  total_likes: number | null;
  video_count: number | null;
  region: string | null;
  bio: string | null;
  verified: boolean;
  song_name: string | null;
  song_author: string | null;
  song_link: string | null;
  song_brief: string | null;
  song_language: string | null;
  artist_brief: string | null;
  custom_dm: string | null;
  status: string | null;
  sent_date: string | null;
  monday_id: string | null;
  selected_mo3ntit_id: string | null;
  first_dm_sent_at: string | null;
  last_prompt_id: string | null;
  current_dm: string | null;
  funnel_stage: string | null;
  created_at: string;
};

export type DmPromptRow = {
  id: string;
  name: string;
  description: string | null;
  template: string;
  is_active: boolean;
  uses: number;
  created_at: string;
  updated_at: string;
};

export type ConversationRow = {
  id: string;
  artist_id: string;
  mo3ntit_id: string | null;
  direction: "in" | "out";
  body: string;
  prompt_id: string | null;
  source: string | null;
  created_at: string;
};

function requireClient(): SupabaseClient {
  const c = getClient();
  if (!c) throw new Error("Supabase not configured");
  return c;
}

export async function getNextArtistForDm(opts: { skipId?: string } = {}): Promise<ArtistRow | null> {
  const c = requireClient();
  let q = c
    .from("artists")
    .select("*")
    .is("first_dm_sent_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (opts.skipId) q = q.neq("id", opts.skipId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`getNextArtistForDm: ${error.message}`);
  return data as ArtistRow | null;
}

export type QueueRow = {
  id: string;
  account: string;
  nickname: string;
  tiktok_profile: string;
  avatar_url: string | null;
  current_dm: string;
  mo3ntit_id: string;
  mo3ntit_handle: string;
  mo3ntit_avatar: string | null;
  created_at: string;
};

export async function listAssignedQueue(): Promise<QueueRow[]> {
  const c = requireClient();
  const { data, error } = await c
    .from("artists")
    .select(
      "id, account, nickname, tiktok_profile, avatar_url, current_dm, created_at, mo3ntitin:selected_mo3ntit_id ( id, handle, avatar_url )",
    )
    .not("current_dm", "is", null)
    .not("selected_mo3ntit_id", "is", null)
    .is("first_dm_sent_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAssignedQueue: ${error.message}`);

  type Joined = {
    id: string;
    account: string;
    nickname: string;
    tiktok_profile: string | null;
    avatar_url: string | null;
    current_dm: string;
    created_at: string;
    mo3ntitin: { id: string; handle: string; avatar_url: string | null } | null;
  };
  return ((data ?? []) as unknown as Joined[]).map((r) => ({
    id: r.id,
    account: r.account,
    nickname: r.nickname,
    tiktok_profile: r.tiktok_profile ?? `https://www.tiktok.com/@${r.account}`,
    avatar_url: r.avatar_url,
    current_dm: r.current_dm,
    created_at: r.created_at,
    mo3ntit_id: r.mo3ntitin?.id ?? "",
    mo3ntit_handle: r.mo3ntitin?.handle ?? "?",
    mo3ntit_avatar: r.mo3ntitin?.avatar_url ?? null,
  }));
}

export async function listPendingArtists(limit: number, opts: { onlyUnassigned?: boolean } = {}): Promise<ArtistRow[]> {
  const c = requireClient();
  let q = c
    .from("artists")
    .select("*")
    .is("first_dm_sent_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.onlyUnassigned) q = q.is("current_dm", null);
  const { data, error } = await q;
  if (error) throw new Error(`listPendingArtists: ${error.message}`);
  return (data ?? []) as ArtistRow[];
}

export async function getArtistById(id: string): Promise<ArtistRow | null> {
  const c = requireClient();
  const { data, error } = await c.from("artists").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getArtistById: ${error.message}`);
  return data as ArtistRow | null;
}

export async function findArtistByHandle(handle: string): Promise<ArtistRow | null> {
  const c = requireClient();
  const clean = handle.replace(/^@/, "").toLowerCase();
  const { data, error } = await c
    .from("artists")
    .select("*")
    .eq("account", clean)
    .maybeSingle();
  if (error) throw new Error(`findArtistByHandle: ${error.message}`);
  return data as ArtistRow | null;
}

export async function insertMinimalArtist(args: {
  account: string;
  nickname: string;
  tiktok_profile: string;
  avatar_url: string | null;
  followers: number | null;
  total_likes: number | null;
  video_count: number | null;
  region: string | null;
  bio: string | null;
  verified: boolean;
}): Promise<ArtistRow> {
  const c = requireClient();
  const { data, error } = await c
    .from("artists")
    .insert({
      ...args,
      account: args.account.toLowerCase(),
      status: "inbound",
    })
    .select("*")
    .single();
  if (error) throw new Error(`insertMinimalArtist: ${error.message}`);
  return data as ArtistRow;
}

export async function listAllMo3ntitin(): Promise<Mo3ntitRow[]> {
  return listMo3ntitin();
}

export async function getMo3ntitAssignmentCounts(): Promise<Map<string, number>> {
  const c = requireClient();
  const { data, error } = await c
    .from("artists")
    .select("selected_mo3ntit_id")
    .not("selected_mo3ntit_id", "is", null);
  if (error) throw new Error(`getMo3ntitAssignmentCounts: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ selected_mo3ntit_id: string }>) {
    counts.set(row.selected_mo3ntit_id, (counts.get(row.selected_mo3ntit_id) ?? 0) + 1);
  }
  return counts;
}

export async function getMo3ntitById(id: string): Promise<Mo3ntitRow | null> {
  const c = requireClient();
  const { data, error } = await c.from("mo3ntitin").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getMo3ntitById: ${error.message}`);
  return data as Mo3ntitRow | null;
}

export async function updateArtistDmDraft(args: {
  artistId: string;
  selectedMo3ntitId: string;
  currentDm: string;
  promptId: string;
}): Promise<void> {
  const c = requireClient();
  const { error } = await c
    .from("artists")
    .update({
      selected_mo3ntit_id: args.selectedMo3ntitId,
      current_dm: args.currentDm,
      last_prompt_id: args.promptId,
    })
    .eq("id", args.artistId);
  if (error) throw new Error(`updateArtistDmDraft: ${error.message}`);
}

export const ARTIST_STATUSES = [
  "new",
  "sent",
  "needs_offer",
  "offer_sent",
  "won",
  "lost",
] as const;
export type ArtistStatus = (typeof ARTIST_STATUSES)[number];

export const STATUS_LABELS: Record<ArtistStatus, string> = {
  new: "New",
  sent: "Sent",
  needs_offer: "Needs offer",
  offer_sent: "Offer sent",
  won: "Won",
  lost: "Lost",
};

export async function updateArtistFunnelStage(
  artistId: string,
  stage: string,
): Promise<void> {
  const c = requireClient();
  const { error } = await c
    .from("artists")
    .update({ funnel_stage: stage })
    .eq("id", artistId);
  if (error) throw new Error(`updateArtistFunnelStage: ${error.message}`);
}

export async function updateArtistStatus(
  artistId: string,
  status: ArtistStatus,
): Promise<{ artistId: string; mondayId: string | null; status: ArtistStatus }> {
  const c = requireClient();
  const { data, error } = await c
    .from("artists")
    .update({ status })
    .eq("id", artistId)
    .select("id, monday_id, status")
    .single();
  if (error) throw new Error(`updateArtistStatus: ${error.message}`);
  const row = data as { id: string; monday_id: string | null; status: ArtistStatus };
  return { artistId: row.id, mondayId: row.monday_id, status: row.status };
}

export async function markFirstDmSent(args: {
  artistId: string;
  mo3ntitId: string;
  body: string;
  promptId: string;
}): Promise<void> {
  const c = requireClient();
  const { error: upErr } = await c
    .from("artists")
    .update({
      first_dm_sent_at: new Date().toISOString(),
      status: "sent",
      current_dm: args.body,
      selected_mo3ntit_id: args.mo3ntitId,
      last_prompt_id: args.promptId,
    })
    .eq("id", args.artistId);
  if (upErr) throw new Error(`markFirstDmSent: ${upErr.message}`);
  await logConversation({
    artistId: args.artistId,
    mo3ntitId: args.mo3ntitId,
    direction: "out",
    body: args.body,
    promptId: args.promptId,
    source: "first_dm",
  });
}

export async function logConversation(args: {
  artistId: string;
  mo3ntitId: string | null;
  direction: "in" | "out";
  body: string;
  promptId?: string | null;
  source?: string;
}): Promise<ConversationRow> {
  const c = requireClient();
  const { data, error } = await c
    .from("conversations")
    .insert({
      artist_id: args.artistId,
      mo3ntit_id: args.mo3ntitId,
      direction: args.direction,
      body: args.body,
      prompt_id: args.promptId ?? null,
      source: args.source ?? "manual",
    })
    .select("*")
    .single();
  if (error) throw new Error(`logConversation: ${error.message}`);
  return data as ConversationRow;
}

export async function listConversation(artistId: string): Promise<ConversationRow[]> {
  const c = requireClient();
  const { data, error } = await c
    .from("conversations")
    .select("*")
    .eq("artist_id", artistId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listConversation: ${error.message}`);
  return (data ?? []) as ConversationRow[];
}

export async function listRecentConversations(limit = 30): Promise<
  Array<ConversationRow & { artist_account: string; artist_nickname: string }>
> {
  const c = requireClient();
  const { data, error } = await c
    .from("conversations")
    .select("*, artists(account, nickname)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentConversations: ${error.message}`);
  return ((data ?? []) as Array<
    ConversationRow & { artists: { account: string; nickname: string } | null }
  >).map((r) => ({
    ...r,
    artist_account: r.artists?.account ?? "",
    artist_nickname: r.artists?.nickname ?? "",
  }));
}

// --- prompts ---

export async function listPrompts(): Promise<DmPromptRow[]> {
  const c = requireClient();
  const { data, error } = await c
    .from("dm_prompts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPrompts: ${error.message}`);
  return (data ?? []) as DmPromptRow[];
}

export async function listActivePrompts(): Promise<DmPromptRow[]> {
  const c = requireClient();
  const { data, error } = await c
    .from("dm_prompts")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listActivePrompts: ${error.message}`);
  return (data ?? []) as DmPromptRow[];
}

export async function getPromptById(id: string): Promise<DmPromptRow | null> {
  const c = requireClient();
  const { data, error } = await c.from("dm_prompts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getPromptById: ${error.message}`);
  return data as DmPromptRow | null;
}

export async function createPrompt(args: {
  name: string;
  description: string | null;
  template: string;
  is_active: boolean;
}): Promise<DmPromptRow> {
  const c = requireClient();
  const { data, error } = await c
    .from("dm_prompts")
    .insert(args)
    .select("*")
    .single();
  if (error) throw new Error(`createPrompt: ${error.message}`);
  return data as DmPromptRow;
}

export async function updatePrompt(
  id: string,
  patch: Partial<Pick<DmPromptRow, "name" | "description" | "template" | "is_active">>,
): Promise<DmPromptRow> {
  const c = requireClient();
  const { data, error } = await c
    .from("dm_prompts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updatePrompt: ${error.message}`);
  return data as DmPromptRow;
}

export async function deletePrompt(id: string): Promise<void> {
  const c = requireClient();
  const { error } = await c.from("dm_prompts").delete().eq("id", id);
  if (error) throw new Error(`deletePrompt: ${error.message}`);
}

export async function incrementPromptUses(id: string): Promise<void> {
  const c = requireClient();
  const { data, error } = await c
    .from("dm_prompts")
    .select("uses")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return;
  await c.from("dm_prompts").update({ uses: ((data as { uses: number }).uses ?? 0) + 1 }).eq("id", id);
}

export async function pickActivePrompt(): Promise<DmPromptRow | null> {
  const active = await listActivePrompts();
  if (active.length === 0) return null;
  return active[Math.floor(Math.random() * active.length)];
}

// --- avatar storage ---

const AVATAR_BUCKET = "avatars";

async function ensureAvatarBucket(): Promise<void> {
  const c = requireClient();
  const { data: existing } = await c.storage.getBucket(AVATAR_BUCKET);
  if (existing) return;
  const { error } = await c.storage.createBucket(AVATAR_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`createBucket: ${error.message}`);
  }
}

export async function uploadAvatar(args: {
  key: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const c = requireClient();
  await ensureAvatarBucket();
  const { error } = await c.storage
    .from(AVATAR_BUCKET)
    .upload(args.key, args.buffer, {
      contentType: args.contentType,
      upsert: true,
      cacheControl: "604800",
    });
  if (error) throw new Error(`upload ${args.key}: ${error.message}`);
  const { data } = c.storage.from(AVATAR_BUCKET).getPublicUrl(args.key);
  return data.publicUrl;
}

export async function updateMo3ntitAvatar(id: string, avatarUrl: string): Promise<void> {
  const c = requireClient();
  const { error } = await c.from("mo3ntitin").update({ avatar_url: avatarUrl }).eq("id", id);
  if (error) throw new Error(`updateMo3ntitAvatar: ${error.message}`);
}

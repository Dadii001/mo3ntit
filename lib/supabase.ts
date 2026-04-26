import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export async function listSupabaseAccounts(): Promise<Set<string>> {
  const c = getClient();
  if (!c) return new Set();
  const { data, error } = await c.from("artists").select("account").limit(2000);
  if (error) return new Set();
  return new Set((data ?? []).map((r: { account: string }) => r.account.toLowerCase()));
}

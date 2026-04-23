import { env } from "./env";
import type { TikTokAuthor, TikTokVideo } from "./types";

const BASE = () => `https://${env.rapidApiHost()}`;

async function rapid<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key": env.rapidApiKey(),
      "x-rapidapi-host": env.rapidApiHost(),
    },
  });
  if (!res.ok) throw new Error(`RapidAPI ${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { code?: number; msg?: string; data?: T };
  if (body.code !== undefined && body.code !== 0) throw new Error(`RapidAPI error: ${body.msg}`);
  return body.data as T;
}

export type HashtagInfo = {
  id: string;
  title: string;
  desc: string;
  view_count: number;
  user_count: number;
};

type ChallengeSearchResp = {
  challenge_list: Array<{
    id: string;
    cha_name: string;
    desc: string;
    user_count: number;
    view_count: number;
  }>;
};

export async function getHashtagInfo(hashtag: string): Promise<HashtagInfo> {
  const cleanName = hashtag.replace(/^#/, "").trim();
  const data = await rapid<ChallengeSearchResp>("/challenge/search", {
    keywords: cleanName,
    count: "10",
    cursor: "0",
  });
  const list = data.challenge_list ?? [];
  const match =
    list.find((c) => c.cha_name?.toLowerCase() === cleanName.toLowerCase()) ?? list[0];
  if (!match) throw new Error(`No hashtag found for #${cleanName}`);
  return {
    id: match.id,
    title: match.cha_name,
    desc: match.desc,
    view_count: match.view_count,
    user_count: match.user_count,
  };
}

type MusicField = {
  id?: string | number;
  mid?: string | number;
  music_id?: string | number;
  title?: string;
  author?: string;
  play?: string;
  play_url?: string | { uri_list?: string[] };
} | null;

function extractMusicId(m: MusicField | undefined): string | null {
  if (!m) return null;
  const raw = m.id ?? m.mid ?? m.music_id;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

function numericId(...candidates: (string | number | undefined)[]): string | null {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const s = String(c);
    if (/^\d{15,}$/.test(s)) return s;
  }
  return null;
}

type RawVideo = {
  aweme_id?: string | number;
  video_id?: string;
  item_id?: string | number;
  id?: string | number;
  title?: string;
  desc?: string;
  create_time: number;
  play?: string;
  wmplay?: string;
  cover?: string;
  origin_cover?: string;
  duration?: number;
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  author: {
    id: string;
    unique_id: string;
    nickname: string;
    avatar: string;
  };
  music?: MusicField;
  music_info?: MusicField;
};

type ChallengePostsResp = {
  cursor: string;
  hasMore: boolean;
  videos: RawVideo[];
};

export async function getHashtagPosts(
  hashtagId: string,
  cursor = "0",
  count = 35,
): Promise<ChallengePostsResp> {
  return rapid<ChallengePostsResp>("/challenge/posts", {
    challenge_id: hashtagId,
    cursor,
    count: String(count),
  });
}

export type RawVideoExport = RawVideo;

export async function getUserPosts(uniqueId: string, count = 15): Promise<RawVideo[]> {
  const data = await rapid<{ videos?: RawVideo[] }>("/user/posts", {
    unique_id: uniqueId,
    count: String(count),
    cursor: "0",
  });
  return data.videos ?? [];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isOwnSong(
  music: { title?: string | null; author?: string | null },
  artist: { uniqueId: string; nickname: string },
): boolean {
  const candidates = [normalize(artist.uniqueId), normalize(artist.nickname)].filter(
    (s) => s.length >= 3,
  );
  if (candidates.length === 0) return false;

  const musicAuthor = normalize(music.author ?? "");
  if (musicAuthor) {
    for (const c of candidates) {
      if (musicAuthor === c) return true;
      if (musicAuthor.includes(c) && c.length >= 4) return true;
      if (c.includes(musicAuthor) && musicAuthor.length >= 4) return true;
    }
  }

  const title = music.title ?? "";
  if (!title) return false;

  const segs = title.split(/\s*[-–—|]\s*/).map(normalize).filter(Boolean);
  for (const seg of segs) {
    for (const c of candidates) {
      if (seg === c) return true;
      if (seg.length >= 4 && (seg.includes(c) || c.includes(seg))) return true;
    }
  }

  const titleNorm = normalize(title);
  for (const c of candidates) {
    if (c.length >= 4 && titleNorm.includes(c)) return true;
  }
  return false;
}

export type SignatureSong = {
  musicId: string | null;
  title: string | null;
  author: string | null;
  playUrl: string | null;
  useCount: number;
  isOwn: boolean;
  videoIds: string[];
  numericVideoIds: string[];
  totalPlays: number;
};

export function pickSignatureSong(
  artist: { uniqueId: string; nickname: string },
  videos: RawVideo[],
): SignatureSong | null {
  const byKey = new Map<string, SignatureSong>();
  for (const v of videos) {
    const m = v.music ?? v.music_info;
    if (!m) continue;
    const extractedId = extractMusicId(m);
    const key = (extractedId ?? m.title ?? "").trim();
    if (!key) continue;
    const own = isOwnSong({ title: m.title, author: m.author }, artist);
    const numericVid = numericId(v.aweme_id, v.item_id, v.id);
    const vid = numericVid ?? String(v.aweme_id ?? v.item_id ?? v.id ?? v.video_id ?? "");
    if (!vid) continue;
    const plays = v.play_count ?? 0;
    const existing = byKey.get(key);
    if (existing) {
      existing.useCount++;
      existing.videoIds.push(vid);
      if (numericVid) existing.numericVideoIds.push(numericVid);
      existing.totalPlays += plays;
      if (!existing.playUrl) existing.playUrl = resolveMusicUrl(m);
    } else {
      byKey.set(key, {
        musicId: extractedId,
        title: m.title ?? null,
        author: m.author ?? null,
        playUrl: resolveMusicUrl(m),
        useCount: 1,
        isOwn: own,
        videoIds: [vid],
        numericVideoIds: numericVid ? [numericVid] : [],
        totalPlays: plays,
      });
    }
  }
  if (byKey.size === 0) return null;
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    if (b.useCount !== a.useCount) return b.useCount - a.useCount;
    return b.totalPlays - a.totalPlays;
  })[0];
}

function resolveMusicUrl(m: MusicField | undefined): string | null {
  if (!m) return null;
  if (typeof m.play === "string" && m.play) return m.play;
  if (typeof m.play_url === "string" && m.play_url) return m.play_url;
  if (m.play_url && typeof m.play_url === "object" && Array.isArray(m.play_url.uri_list)) {
    return m.play_url.uri_list[0] ?? null;
  }
  return null;
}

type RawUserInfo = {
  user: {
    id: string;
    uniqueId: string;
    nickname: string;
    signature?: string;
    avatarLarger?: string;
    avatarMedium?: string;
    verified?: boolean;
    region?: string;
  };
  stats?: {
    followerCount?: number;
    followingCount?: number;
    heartCount?: number;
    videoCount?: number;
  };
};

export async function getUserInfo(uniqueId: string): Promise<TikTokAuthor> {
  const data = await rapid<RawUserInfo>("/user/info", { unique_id: uniqueId });
  const stats = data.stats ?? {};
  return {
    uid: data.user.id,
    uniqueId: data.user.uniqueId,
    nickname: data.user.nickname,
    signature: data.user.signature ?? "",
    avatarLarger: data.user.avatarLarger ?? data.user.avatarMedium ?? "",
    followerCount: stats.followerCount ?? 0,
    followingCount: stats.followingCount ?? 0,
    heartCount: stats.heartCount ?? 0,
    videoCount: stats.videoCount ?? 0,
    verified: data.user.verified ?? false,
    region: data.user.region ?? null,
  };
}

export function videosFromHashtagPosts(
  resp: ChallengePostsResp,
  seenAuthors = new Set<string>(),
): { byAuthor: Map<string, TikTokVideo> } {
  const byAuthor = new Map<string, TikTokVideo>();
  for (const v of resp.videos ?? []) {
    const uniqueId = v.author?.unique_id;
    if (!uniqueId) continue;
    if (seenAuthors.has(uniqueId) || byAuthor.has(uniqueId)) continue;
    const music = v.music ?? v.music_info ?? null;
    const video: TikTokVideo = {
      id: numericId(v.aweme_id, v.item_id, v.id) ?? "",
      desc: v.title ?? v.desc ?? "",
      createTime: v.create_time,
      playUrl: v.play ?? v.wmplay ?? null,
      musicTitle: music?.title ?? null,
      musicAuthor: music?.author ?? null,
      musicPlayUrl: resolveMusicUrl(music),
      stats: {
        plays: v.play_count ?? 0,
        likes: v.digg_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
      },
      author: {
        uid: v.author.id,
        uniqueId: v.author.unique_id,
        nickname: v.author.nickname,
        signature: "",
        avatarLarger: v.author.avatar,
        followerCount: 0,
        followingCount: 0,
        heartCount: 0,
        videoCount: 0,
        verified: false,
        region: null,
      },
    };
    byAuthor.set(uniqueId, video);
  }
  return { byAuthor };
}

export function tiktokProfileUrl(uniqueId: string): string {
  return `https://www.tiktok.com/@${uniqueId}`;
}

export function tiktokVideoUrl(uniqueId: string, videoId: string): string {
  return `https://www.tiktok.com/@${uniqueId}/video/${videoId}`;
}

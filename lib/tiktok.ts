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
  title?: string;
  author?: string;
  play?: string;
  play_url?: string | { uri_list?: string[] };
} | null;

type RawVideo = {
  aweme_id?: string;
  video_id?: string;
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
      id: v.aweme_id ?? v.video_id ?? "",
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

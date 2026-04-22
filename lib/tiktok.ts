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

type HashtagInfoResp = { id: string; title: string; desc: string; view_count: number; video_count: number };

export async function getHashtagInfo(hashtag: string): Promise<HashtagInfoResp> {
  return rapid<HashtagInfoResp>("/api/hashtag/info", { name: hashtag.replace(/^#/, "") });
}

type HashtagPostsResp = {
  cursor: string;
  hasMore: boolean;
  videos: Array<{
    video_id: string;
    title: string;
    create_time: number;
    play: string;
    music_info: { title: string; author: string; play: string } | null;
    play_count: number;
    digg_count: number;
    comment_count: number;
    share_count: number;
    author: {
      id: string;
      unique_id: string;
      nickname: string;
      avatar: string;
    };
  }>;
};

export async function getHashtagPosts(
  hashtagId: string,
  cursor = "0",
  count = 50,
): Promise<HashtagPostsResp> {
  return rapid<HashtagPostsResp>("/api/challenge/posts", {
    challenge_id: hashtagId,
    cursor,
    count: String(count),
  });
}

type UserInfoResp = {
  user: {
    id: string;
    uniqueId: string;
    nickname: string;
    signature: string;
    avatarLarger: string;
    verified: boolean;
    region?: string;
  };
  stats: {
    followerCount: number;
    followingCount: number;
    heartCount: number;
    videoCount: number;
  };
};

export async function getUserInfo(uniqueId: string): Promise<TikTokAuthor> {
  const data = await rapid<UserInfoResp>("/api/user/info", { unique_id: uniqueId });
  return {
    uid: data.user.id,
    uniqueId: data.user.uniqueId,
    nickname: data.user.nickname,
    signature: data.user.signature ?? "",
    avatarLarger: data.user.avatarLarger,
    followerCount: data.stats.followerCount,
    followingCount: data.stats.followingCount,
    heartCount: data.stats.heartCount,
    videoCount: data.stats.videoCount,
    verified: data.user.verified,
    region: data.user.region ?? null,
  };
}

export function videosFromHashtagPosts(
  resp: HashtagPostsResp,
  seenAuthors = new Set<string>(),
): { byAuthor: Map<string, TikTokVideo> } {
  const byAuthor = new Map<string, TikTokVideo>();
  for (const v of resp.videos) {
    const uniqueId = v.author.unique_id;
    if (seenAuthors.has(uniqueId) || byAuthor.has(uniqueId)) continue;
    const video: TikTokVideo = {
      id: v.video_id,
      desc: v.title ?? "",
      createTime: v.create_time,
      playUrl: v.play ?? null,
      musicTitle: v.music_info?.title ?? null,
      musicAuthor: v.music_info?.author ?? null,
      musicPlayUrl: v.music_info?.play ?? null,
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

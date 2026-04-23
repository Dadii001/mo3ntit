import { analyzeAudio } from "../audio";
import { analyzeBio, buildArtistBrief, buildCustomDm, buildSongBrief } from "../bio";
import { createArtistItem, listExistingArtists } from "../monday";
import {
  getHashtagInfo,
  getHashtagPosts,
  getUserInfo,
  getUserPosts,
  pickSignatureSong,
  tiktokProfileUrl,
  tiktokVideoUrl,
  videosFromHashtagPosts,
} from "../tiktok";
import type {
  ArtistProfile,
  DiscoveryEvent,
  SongAnalysis,
  TikTokAuthor,
  TikTokVideo,
} from "../types";
import { analyzeProfileImage } from "../vision";

export type Bounds = {
  minFollowers?: number;
  maxFollowers?: number;
};

export type EnrichResult =
  | { status: "saved"; mondayId: string; username: string }
  | { status: "skipped"; username: string; reason: string }
  | { status: "error"; username: string; message: string };

type Emit = (e: DiscoveryEvent) => void;

const DEFAULT_MIN_FOLLOWERS = 1000;
const DEFAULT_MAX_FOLLOWERS = 500_000;

export async function enrichAndSaveArtist(
  username: string,
  seedVideo: TikTokVideo | null,
  bounds: Bounds,
  emit: Emit,
): Promise<EnrichResult> {
  const minFollowers = bounds.minFollowers ?? DEFAULT_MIN_FOLLOWERS;
  const maxFollowers = bounds.maxFollowers ?? DEFAULT_MAX_FOLLOWERS;

  try {
    const author = await getUserInfo(username);

    if (author.followerCount < minFollowers) {
      emit({ type: "skipped", username, reason: `followers ${author.followerCount} < ${minFollowers}` });
      return { status: "skipped", username, reason: `below_min_followers` };
    }
    if (author.followerCount > maxFollowers) {
      emit({ type: "skipped", username, reason: `followers ${author.followerCount} > ${maxFollowers}` });
      return { status: "skipped", username, reason: `above_max_followers` };
    }

    emit({ type: "log", level: "info", message: `[${username}] analyzing profile image…` });
    const image = await analyzeProfileImage(author.avatarLarger).catch((e) => {
      emit({ type: "log", level: "warn", message: `[${username}] vision failed: ${e.message}` });
      return {
        visualStyle: "unknown",
        mood: "unknown",
        genreHints: [],
        description: "(image analysis failed)",
      };
    });

    emit({ type: "log", level: "info", message: `[${username}] analyzing bio…` });
    const bioAnalysis = await analyzeBio(author.signature, author.nickname).catch(() => ({
      name: null,
      location: null,
      genres: [],
      instruments: [],
      contactLinks: [],
      summary: "(bio analysis failed)",
    }));

    emit({ type: "log", level: "info", message: `[${username}] pulling recent posts (user_id=${author.uid})…` });
    let recentPosts: Awaited<ReturnType<typeof getUserPosts>> = [];
    try {
      recentPosts = await getUserPosts(author.uid, 15);
    } catch (e) {
      emit({
        type: "log",
        level: "warn",
        message: `[${username}] /user/posts failed: ${(e as Error).message}`,
      });
    }
    const signature = pickSignatureSong(
      { uniqueId: author.uniqueId, nickname: author.nickname },
      recentPosts,
    );

    const fallbackVideo: TikTokVideo = seedVideo ?? makeStubVideo(author);

    const songTitle = signature?.title ?? fallbackVideo.musicTitle;
    const songAuthor = signature?.author ?? fallbackVideo.musicAuthor;
    const songUrl = signature?.playUrl ?? fallbackVideo.musicPlayUrl;
    const useCount = signature?.useCount ?? 1;
    const totalPlays = signature?.totalPlays ?? fallbackVideo.stats.plays;
    const isOriginal = signature?.isOwn ?? false;

    if (signature) {
      emit({
        type: "log",
        level: "info",
        message: `[${username}] signature: "${signature.title ?? "(untitled)"}" — used ${signature.useCount}×, ${isOriginal ? "likely own" : "origin unclear"}`,
      });
    }

    const songSourceNumericId = signature
      ? signature.numericVideoIds[0] ?? null
      : /^\d{15,}$/.test(fallbackVideo.id) ? fallbackVideo.id : null;
    const signatureVideoUrl = songSourceNumericId
      ? tiktokVideoUrl(author.uniqueId, songSourceNumericId)
      : tiktokProfileUrl(author.uniqueId);

    let song: SongAnalysis = {
      musicId: signature?.musicId ?? null,
      videoUrl: signatureVideoUrl,
      url: songUrl,
      title: songTitle,
      author: songAuthor,
      bpm: null,
      durationSec: null,
      transcript: null,
      language: null,
      isOriginal,
      useCount,
      totalVideoPlays: totalPlays,
      brief: "",
    };

    if (songUrl) {
      emit({ type: "log", level: "info", message: `[${username}] downloading + analyzing signature song…` });
      try {
        const audio = await analyzeAudio(songUrl);
        song = { ...song, ...audio };
      } catch (e) {
        emit({
          type: "log",
          level: "warn",
          message: `[${username}] audio analysis failed: ${(e as Error).message}`,
        });
      }
    }

    song.brief = await buildSongBrief({
      musicTitle: songTitle,
      musicAuthor: songAuthor,
      bpm: song.bpm,
      durationSec: song.durationSec,
      transcript: song.transcript,
      videoDesc: fallbackVideo.desc,
      isOriginal,
      useCount,
      totalPlays,
      recentVideoCount: recentPosts.length,
    });

    const baseProfile: Omit<ArtistProfile, "artistBrief" | "customDm"> = {
      username: author.uniqueId,
      nickname: author.nickname,
      profileUrl: tiktokProfileUrl(author.uniqueId),
      avatarUrl: author.avatarLarger,
      followers: author.followerCount,
      totalLikes: author.heartCount,
      videoCount: author.videoCount,
      region: author.region,
      bio: author.signature,
      verified: author.verified,
      topVideo: { ...fallbackVideo, author },
      image,
      bioAnalysis,
      song,
    };

    const [artistBrief, customDm] = await Promise.all([
      buildArtistBrief({ author, video: fallbackVideo, image, bioAnalysis, song }),
      buildCustomDm(baseProfile),
    ]);

    const artist: ArtistProfile = { ...baseProfile, artistBrief, customDm };

    emit({
      type: "artist",
      artist: {
        username: artist.username,
        nickname: artist.nickname,
        followers: artist.followers,
        artistBrief: artist.artistBrief,
        customDm: artist.customDm,
        song: artist.song,
        image: artist.image,
      },
    });

    const created = await createArtistItem(artist);
    emit({
      type: "log",
      level: "info",
      message: `[${username}] → Monday: song="${artist.song.title ?? "(untitled)"}" link=${artist.song.videoUrl ?? "(none)"}`,
    });
    emit({ type: "saved", username: artist.username, mondayId: created.id });
    return { status: "saved", mondayId: created.id, username: artist.username };
  } catch (e) {
    emit({
      type: "log",
      level: "error",
      message: `[${username}] failed: ${(e as Error).message}`,
    });
    return { status: "error", username, message: (e as Error).message };
  }
}

function makeStubVideo(author: TikTokAuthor): TikTokVideo {
  return {
    id: "",
    desc: "",
    createTime: 0,
    playUrl: null,
    musicTitle: null,
    musicAuthor: null,
    musicPlayUrl: null,
    stats: { plays: 0, likes: 0, comments: 0, shares: 0 },
    author,
  };
}

export type DiscoveryInput = {
  hashtag: string;
  maxPages?: number;
  maxArtists?: number;
  minFollowers?: number;
  maxFollowers?: number;
};

export async function collectHashtagCandidates(
  hashtag: string,
  maxPages: number,
  skip: Set<string>,
  emit: Emit,
): Promise<Map<string, TikTokVideo>> {
  const info = await getHashtagInfo(hashtag);
  emit({
    type: "log",
    level: "info",
    message: `Hashtag loaded: ${info.title} (${info.view_count.toLocaleString()} views)`,
  });
  const candidates = new Map<string, TikTokVideo>();
  let cursor = "0";
  for (let page = 0; page < maxPages; page++) {
    emit({ type: "log", level: "info", message: `Scanning page ${page + 1}/${maxPages}…` });
    const posts = await getHashtagPosts(info.id, cursor, 50);
    const { byAuthor } = videosFromHashtagPosts(posts, skip);
    for (const [username, video] of byAuthor) {
      if (!candidates.has(username)) candidates.set(username, video);
    }
    if (!posts.hasMore) break;
    cursor = posts.cursor;
  }
  return candidates;
}

export async function runDiscovery(input: DiscoveryInput, emit: Emit): Promise<void> {
  const maxPages = input.maxPages ?? 5;
  const maxArtists = input.maxArtists ?? 10;
  const bounds: Bounds = {
    minFollowers: input.minFollowers,
    maxFollowers: input.maxFollowers,
  };

  emit({ type: "log", level: "info", message: `Starting discovery for #${input.hashtag}` });

  emit({ type: "log", level: "info", message: "Fetching already-saved artists from Monday…" });
  const existing = await listExistingArtists();
  emit({ type: "log", level: "info", message: `${existing.size} artists already in board — will skip.` });

  const candidates = await collectHashtagCandidates(input.hashtag, maxPages, existing, emit);
  emit({
    type: "log",
    level: "info",
    message: `${candidates.size} unique candidates collected. Enriching up to ${maxArtists}.`,
  });

  let saved = 0;
  let skipped = 0;
  const total = Math.min(candidates.size, maxArtists);
  let i = 0;

  for (const [username, video] of candidates) {
    if (saved >= maxArtists) break;
    i++;
    emit({ type: "progress", current: i, total, stage: `@${username}` });
    const result = await enrichAndSaveArtist(username, video, bounds, emit);
    if (result.status === "saved") saved++;
    else skipped++;
  }

  emit({ type: "done", saved, skipped });
}

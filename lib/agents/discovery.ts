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
  videosFromHashtagPosts,
} from "../tiktok";
import type { ArtistProfile, DiscoveryEvent, SongAnalysis, TikTokVideo } from "../types";
import { analyzeProfileImage } from "../vision";

export type DiscoveryInput = {
  hashtag: string;
  maxPages?: number;
  maxArtists?: number;
  minFollowers?: number;
  maxFollowers?: number;
  olderThanSec?: number;
};

type Emit = (e: DiscoveryEvent) => void;

export async function runDiscovery(input: DiscoveryInput, emit: Emit): Promise<void> {
  const maxPages = input.maxPages ?? 5;
  const maxArtists = input.maxArtists ?? 10;
  const minFollowers = input.minFollowers ?? 1000;
  const maxFollowers = input.maxFollowers ?? 500_000;

  emit({ type: "log", level: "info", message: `Starting discovery for #${input.hashtag}` });

  const hashtag = await getHashtagInfo(input.hashtag);
  emit({
    type: "log",
    level: "info",
    message: `Hashtag loaded: ${hashtag.title} (${hashtag.view_count.toLocaleString()} views)`,
  });

  emit({ type: "log", level: "info", message: "Fetching already-saved artists from Monday…" });
  const existing = await listExistingArtists();
  emit({ type: "log", level: "info", message: `${existing.size} artists already in board — will skip.` });

  const seen = new Set<string>(existing);
  const candidates = new Map<string, TikTokVideo>();
  let cursor = "0";
  for (let page = 0; page < maxPages && candidates.size < maxArtists * 3; page++) {
    emit({ type: "log", level: "info", message: `Scanning page ${page + 1}/${maxPages}…` });
    const posts = await getHashtagPosts(hashtag.id, cursor, 50);
    const { byAuthor } = videosFromHashtagPosts(posts, seen);
    for (const [username, video] of byAuthor) {
      if (!candidates.has(username)) candidates.set(username, video);
    }
    if (!posts.hasMore) break;
    cursor = posts.cursor;
  }

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

    try {
      const author = await getUserInfo(username);

      if (author.followerCount < minFollowers) {
        emit({ type: "skipped", username, reason: `followers ${author.followerCount} < ${minFollowers}` });
        skipped++;
        continue;
      }
      if (author.followerCount > maxFollowers) {
        emit({ type: "skipped", username, reason: `followers ${author.followerCount} > ${maxFollowers}` });
        skipped++;
        continue;
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

      emit({ type: "log", level: "info", message: `[${username}] pulling recent posts to find signature song…` });
      const recentPosts = await getUserPosts(username, 15).catch(() => []);
      const signature = pickSignatureSong(
        { uniqueId: author.uniqueId, nickname: author.nickname },
        recentPosts,
      );

      const songTitle = signature?.title ?? video.musicTitle;
      const songAuthor = signature?.author ?? video.musicAuthor;
      const songUrl = signature?.playUrl ?? video.musicPlayUrl;
      const useCount = signature?.useCount ?? 1;
      const totalPlays = signature?.totalPlays ?? video.stats.plays;
      const isOriginal = signature?.isOwn ?? false;

      if (signature) {
        emit({
          type: "log",
          level: "info",
          message: `[${username}] signature: "${signature.title ?? "(untitled)"}" by ${signature.author ?? "?"} — used ${signature.useCount}×, ${isOriginal ? "likely own" : "not confirmed as own"}`,
        });
      }

      let song: SongAnalysis = {
        musicId: signature?.musicId ?? null,
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
        videoDesc: video.desc,
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
        topVideo: { ...video, author },
        image,
        bioAnalysis,
        song,
      };

      const [artistBrief, customDm] = await Promise.all([
        buildArtistBrief({ author, video, image, bioAnalysis, song }),
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
      emit({ type: "saved", username: artist.username, mondayId: created.id });
      saved++;
    } catch (e) {
      emit({
        type: "log",
        level: "error",
        message: `[${username}] failed: ${(e as Error).message}`,
      });
      skipped++;
    }
  }

  emit({ type: "done", saved, skipped });
}

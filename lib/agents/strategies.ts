import { listExistingArtists, listRecentArtists, MONDAY_COLUMNS } from "../monday";
import {
  collectHashtagCandidates,
  enrichAndSaveArtist,
  type Bounds,
  type EnrichResult,
} from "./discovery";
import {
  loadState,
  markHashtagRun,
  pickStaleHashtag,
  appendHistory,
  type StrategyId,
} from "./state";
import { getUserFollowing, getUserInfo, getMusicPosts, videosFromHashtagPosts } from "../tiktok";
import type { DiscoveryEvent } from "../types";

export type TickInput = {
  maxPerTick?: number;
  bounds?: Bounds;
  strategy?: StrategyId;
};

export type TickResult = {
  strategy: StrategyId;
  picked: string;
  results: EnrichResult[];
};

type Emit = (e: DiscoveryEvent) => void;

export async function pickStrategy(): Promise<StrategyId> {
  const state = await loadState();
  // Alternate between strategies; favor hashtag when other two have no seed data.
  const saved = await listRecentArtists(10);
  const hasExistingArtists = saved.length > 0;
  const rotation: StrategyId[] = hasExistingArtists
    ? ["hashtag-rotation", "related-following", "hashtag-rotation", "music-explore"]
    : ["hashtag-rotation"];
  const lastIdx = state.lastStrategy ? rotation.indexOf(state.lastStrategy) : -1;
  const nextIdx = (lastIdx + 1) % rotation.length;
  return rotation[nextIdx];
}

export async function runHashtagStrategy(
  maxPerTick: number,
  bounds: Bounds,
  emit: Emit,
): Promise<TickResult> {
  const state = await loadState();
  const cursor = pickStaleHashtag(state, 60 * 60 * 1000);
  const hashtag = cursor?.hashtag ?? state.hashtags[0].hashtag;
  emit({ type: "log", level: "info", message: `[hashtag-rotation] picked #${hashtag}` });

  const existing = await listExistingArtists();
  const candidates = await collectHashtagCandidates(hashtag, 2, existing, emit);
  emit({ type: "log", level: "info", message: `collected ${candidates.size} candidates, enriching up to ${maxPerTick}` });

  const results: EnrichResult[] = [];
  let saved = 0;
  for (const [username, video] of candidates) {
    if (saved >= maxPerTick) break;
    const res = await enrichAndSaveArtist(username, video, bounds, emit);
    results.push(res);
    if (res.status === "saved") saved++;
  }
  await markHashtagRun(hashtag, saved);
  return { strategy: "hashtag-rotation", picked: `#${hashtag}`, results };
}

export async function runRelatedFollowingStrategy(
  maxPerTick: number,
  bounds: Bounds,
  emit: Emit,
): Promise<TickResult> {
  const recent = await listRecentArtists(20);
  if (recent.length === 0) {
    emit({ type: "log", level: "warn", message: "[related-following] no seed artists in Monday yet" });
    return { strategy: "related-following", picked: "none", results: [] };
  }
  const seed = recent[Math.floor(Math.random() * recent.length)];
  const seedHandle = seed.account;
  emit({ type: "log", level: "info", message: `[related-following] exploring @${seedHandle}'s following` });

  let author;
  try {
    author = await getUserInfo(seedHandle);
  } catch (e) {
    emit({ type: "log", level: "warn", message: `[related-following] getUserInfo failed: ${(e as Error).message}` });
    return { strategy: "related-following", picked: seedHandle, results: [] };
  }

  const following = await getUserFollowing(author.uid, 30);
  emit({ type: "log", level: "info", message: `[related-following] ${following.length} followings to scan` });

  const existing = await listExistingArtists();
  const results: EnrichResult[] = [];
  let saved = 0;
  for (const u of following) {
    if (saved >= maxPerTick) break;
    if (!u.uniqueId || existing.has(u.uniqueId.toLowerCase())) continue;
    const res = await enrichAndSaveArtist(u.uniqueId, null, bounds, emit);
    results.push(res);
    if (res.status === "saved") saved++;
  }
  return { strategy: "related-following", picked: `@${seedHandle}`, results };
}

export async function runMusicExploreStrategy(
  maxPerTick: number,
  bounds: Bounds,
  emit: Emit,
): Promise<TickResult> {
  // Pull a random existing artist, get their signature music, find other creators using it.
  const recent = await listRecentArtists(20);
  if (recent.length === 0) {
    emit({ type: "log", level: "warn", message: "[music-explore] no seed artists" });
    return { strategy: "music-explore", picked: "none", results: [] };
  }
  const seed = recent[Math.floor(Math.random() * recent.length)];
  const author = await getUserInfo(seed.account).catch(() => null);
  if (!author) {
    return { strategy: "music-explore", picked: seed.account, results: [] };
  }

  const posts = await import("../tiktok").then((m) => m.getUserPosts(author.uid, 10));
  const sig = await import("../tiktok").then((m) =>
    m.pickSignatureSong({ uniqueId: author.uniqueId, nickname: author.nickname }, posts),
  );
  if (!sig?.musicId) {
    emit({ type: "log", level: "warn", message: `[music-explore] no signature music id for @${seed.account}` });
    return { strategy: "music-explore", picked: seed.account, results: [] };
  }

  emit({
    type: "log",
    level: "info",
    message: `[music-explore] scanning other creators using "${sig.title ?? sig.musicId}"`,
  });
  const otherPosts = await getMusicPosts(sig.musicId, 30);
  const byAuthor = videosFromHashtagPosts(
    { cursor: "0", hasMore: false, videos: otherPosts },
    new Set([author.uniqueId.toLowerCase()]),
  ).byAuthor;

  const existing = await listExistingArtists();
  const results: EnrichResult[] = [];
  let saved = 0;
  for (const [username, video] of byAuthor) {
    if (saved >= maxPerTick) break;
    if (existing.has(username.toLowerCase())) continue;
    const res = await enrichAndSaveArtist(username, video, bounds, emit);
    results.push(res);
    if (res.status === "saved") saved++;
  }
  return { strategy: "music-explore", picked: `music:${sig.title ?? sig.musicId}`, results };
}

export async function runTick(input: TickInput, emit: Emit): Promise<TickResult> {
  const maxPerTick = input.maxPerTick ?? 1;
  const bounds = input.bounds ?? {};
  const strategy = input.strategy ?? (await pickStrategy());
  emit({ type: "log", level: "info", message: `[tick] strategy = ${strategy}` });

  let result: TickResult;
  try {
    if (strategy === "hashtag-rotation") {
      result = await runHashtagStrategy(maxPerTick, bounds, emit);
    } else if (strategy === "related-following") {
      result = await runRelatedFollowingStrategy(maxPerTick, bounds, emit);
    } else {
      result = await runMusicExploreStrategy(maxPerTick, bounds, emit);
    }
  } catch (e) {
    const msg = (e as Error).message;
    emit({ type: "log", level: "error", message: `[tick] ${strategy} failed: ${msg}` });
    await appendHistory({
      at: Date.now(),
      strategy,
      picked: "(error)",
      saved: 0,
      skipped: 0,
      error: msg,
    });
    return { strategy, picked: "(error)", results: [] };
  }

  const saved = result.results.filter((r) => r.status === "saved").length;
  const skipped = result.results.length - saved;
  await appendHistory({ at: Date.now(), strategy, picked: result.picked, saved, skipped });
  emit({ type: "done", saved, skipped });
  return result;
}

export { MONDAY_COLUMNS };

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export type StrategyId = "hashtag-rotation" | "related-following" | "music-explore";

export type HashtagCursor = {
  hashtag: string;
  lastRunAt: number;
  lastSavedCount: number;
  totalRuns: number;
};

export type StrategyRun = {
  at: number;
  strategy: StrategyId;
  picked: string;
  saved: number;
  skipped: number;
  error?: string;
};

export type AgentState = {
  updatedAt: number;
  continuous: boolean;
  hashtags: HashtagCursor[];
  relatedCursor: { seedAccount: string | null; page: number } | null;
  musicCursor: { musicId: string | null; seedArtist: string | null } | null;
  history: StrategyRun[];
  lastStrategy: StrategyId | null;
};

const DEFAULT_HASHTAGS = [
  "indieartist",
  "bedroompop",
  "unsignedartist",
  "singersongwriter",
  "originalmusic",
  "newartist",
  "upcomingartist",
  "indiefolk",
  "bedroomlofi",
  "dreampop",
  "newmusic",
  "musicianlife",
  "songwriter",
  "originalsong",
  "indiemusic",
];

function defaultState(): AgentState {
  const now = Date.now();
  return {
    updatedAt: now,
    continuous: false,
    hashtags: DEFAULT_HASHTAGS.map((h) => ({
      hashtag: h,
      lastRunAt: 0,
      lastSavedCount: 0,
      totalRuns: 0,
    })),
    relatedCursor: null,
    musicCursor: null,
    history: [],
    lastStrategy: null,
  };
}

const STATE_FILE = join(
  process.env.AGENT_STATE_DIR || join(tmpdir(), "indie-artist-finder"),
  "agent-state.json",
);

let cached: AgentState | null = null;

export async function loadState(): Promise<AgentState> {
  if (cached) return cached;
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    cached = JSON.parse(raw) as AgentState;
    const seen = new Set(cached.hashtags.map((h) => h.hashtag));
    for (const h of DEFAULT_HASHTAGS) {
      if (!seen.has(h)) {
        cached.hashtags.push({ hashtag: h, lastRunAt: 0, lastSavedCount: 0, totalRuns: 0 });
      }
    }
    return cached;
  } catch {
    cached = defaultState();
    return cached;
  }
}

export async function saveState(state: AgentState): Promise<void> {
  state.updatedAt = Date.now();
  cached = state;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function appendHistory(run: StrategyRun, maxEntries = 200): Promise<void> {
  const state = await loadState();
  state.history.unshift(run);
  if (state.history.length > maxEntries) state.history.length = maxEntries;
  state.lastStrategy = run.strategy;
  await saveState(state);
}

export async function setContinuous(continuous: boolean): Promise<AgentState> {
  const state = await loadState();
  state.continuous = continuous;
  await saveState(state);
  return state;
}

export function pickStaleHashtag(state: AgentState, minGapMs = 2 * 60 * 60 * 1000): HashtagCursor | null {
  const now = Date.now();
  const candidates = state.hashtags
    .filter((h) => now - h.lastRunAt >= minGapMs)
    .sort((a, b) => a.lastRunAt - b.lastRunAt);
  return candidates[0] ?? null;
}

export async function markHashtagRun(hashtag: string, saved: number): Promise<void> {
  const state = await loadState();
  const entry = state.hashtags.find((h) => h.hashtag === hashtag);
  if (entry) {
    entry.lastRunAt = Date.now();
    entry.lastSavedCount = saved;
    entry.totalRuns++;
  }
  await saveState(state);
}

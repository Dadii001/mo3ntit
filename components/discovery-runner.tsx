"use client";

import { useRef, useState } from "react";
import type { DiscoveryEvent } from "@/lib/types";

type FoundArtist = {
  username: string;
  nickname?: string;
  followers?: number;
  artistBrief?: string;
  customDm?: string;
  song?: { bpm?: number | null; brief?: string };
  image?: { mood?: string; genreHints?: string[] };
  mondayId?: string;
};

export function DiscoveryRunner() {
  const [hashtag, setHashtag] = useState("indieartist");
  const [maxPages, setMaxPages] = useState(5);
  const [maxArtists, setMaxArtists] = useState(5);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [maxFollowers, setMaxFollowers] = useState(500000);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ level: string; message: string; ts: number }>>([]);
  const [progress, setProgress] = useState<{ current: number; total: number; stage: string } | null>(null);
  const [artists, setArtists] = useState<Record<string, FoundArtist>>({});
  const [summary, setSummary] = useState<{ saved: number; skipped: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const log = (level: string, message: string) => {
    setLogs((prev) => [...prev, { level, message, ts: Date.now() }]);
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), 10);
  };

  async function run() {
    setRunning(true);
    setLogs([]);
    setArtists({});
    setSummary(null);
    setProgress(null);
    try {
      const res = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashtag: hashtag.replace(/^#/, ""),
          maxPages,
          maxArtists,
          minFollowers,
          maxFollowers,
        }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            handleEvent(JSON.parse(data) as DiscoveryEvent);
          } catch {}
        }
      }
    } catch (e) {
      log("error", (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(e: DiscoveryEvent) {
    switch (e.type) {
      case "log":
        log(e.level, e.message);
        break;
      case "progress":
        setProgress({ current: e.current, total: e.total, stage: e.stage });
        break;
      case "artist":
        setArtists((p) => ({
          ...p,
          [e.artist.username]: { ...p[e.artist.username], ...(e.artist as FoundArtist) },
        }));
        break;
      case "saved":
        setArtists((p) => ({
          ...p,
          [e.username]: { ...(p[e.username] ?? { username: e.username }), mondayId: e.mondayId },
        }));
        log("ok", `Saved @${e.username} → Monday #${e.mondayId}`);
        break;
      case "skipped":
        log("warn", `Skipped @${e.username}: ${e.reason}`);
        break;
      case "done":
        setSummary({ saved: e.saved, skipped: e.skipped });
        log("ok", `Done — ${e.saved} saved, ${e.skipped} skipped`);
        break;
      case "error":
        log("error", e.message);
        break;
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
      <div className="card p-5 h-fit space-y-4">
        <div>
          <label className="label">Hashtag</label>
          <input className="input" value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="indieartist" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Max pages</label>
            <input
              type="number"
              className="input"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Max artists</label>
            <input
              type="number"
              className="input"
              value={maxArtists}
              onChange={(e) => setMaxArtists(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Min followers</label>
            <input
              type="number"
              className="input"
              value={minFollowers}
              onChange={(e) => setMinFollowers(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Max followers</label>
            <input
              type="number"
              className="input"
              value={maxFollowers}
              onChange={(e) => setMaxFollowers(Number(e.target.value))}
            />
          </div>
        </div>
        <button className="btn w-full" onClick={run} disabled={running}>
          {running ? "Running…" : "Run Discovery"}
        </button>

        {progress && (
          <div className="mt-2">
            <div className="text-xs text-neutral-400 mb-1">
              {progress.current}/{progress.total} — {progress.stage}
            </div>
            <div className="h-1.5 w-full bg-[var(--color-surface)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all"
                style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {summary && (
          <div className="mt-2 text-sm border-t border-[var(--color-border)] pt-3">
            <div>
              <span className="text-green-400">{summary.saved}</span> saved
            </div>
            <div>
              <span className="text-yellow-400">{summary.skipped}</span> skipped
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <section className="card p-5">
          <h3 className="font-semibold mb-3">Live log</h3>
          <div
            ref={logRef}
            className="mono max-h-64 overflow-auto border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-ink)]"
          >
            {logs.length === 0 && <div className="text-neutral-500">Idle. Hit Run.</div>}
            {logs.map((l, i) => (
              <div key={i} className={`log-line log-${l.level}`}>
                {new Date(l.ts).toLocaleTimeString()} — {l.message}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-semibold mb-3">Found artists ({Object.keys(artists).length})</h3>
          <div className="space-y-3">
            {Object.values(artists).map((a) => (
              <div key={a.username} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <a
                      href={`https://www.tiktok.com/@${a.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold hover:text-[var(--color-accent)]"
                    >
                      @{a.username}
                    </a>
                    {a.nickname && <div className="text-sm text-neutral-400">{a.nickname}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {a.followers != null && (
                      <span className="pill mono">{a.followers.toLocaleString()} followers</span>
                    )}
                    {a.song?.bpm != null && <span className="pill mono">{a.song.bpm} BPM</span>}
                    {a.mondayId && <span className="pill pill-live">Saved #{a.mondayId}</span>}
                  </div>
                </div>
                {a.artistBrief && <p className="text-sm text-neutral-300 mb-2">{a.artistBrief}</p>}
                {a.song?.brief && (
                  <div className="text-xs text-neutral-500 italic border-l-2 border-[var(--color-border)] pl-3 mb-2">
                    {a.song.brief}
                  </div>
                )}
                {a.customDm && (
                  <details>
                    <summary className="text-xs text-neutral-400 cursor-pointer hover:text-white">
                      Custom DM draft
                    </summary>
                    <div className="text-sm bg-[var(--color-ink)] border border-[var(--color-border)] rounded-md p-3 mt-2 whitespace-pre-wrap">
                      {a.customDm}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

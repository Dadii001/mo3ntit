"use client";

import { useEffect, useRef, useState } from "react";

type State = {
  continuous: boolean;
  updatedAt: number;
  lastStrategy: string | null;
  history: Array<{
    at: number;
    strategy: string;
    picked: string;
    saved: number;
    skipped: number;
    error?: string;
  }>;
  hashtags: Array<{ hashtag: string; lastRunAt: number; lastSavedCount: number; totalRuns: number }>;
};

const TICK_INTERVAL_MS = 60 * 1000; // browser-side poll for UI refresh only

export function ContinuousPanel() {
  const [state, setState] = useState<State | null>(null);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/agents/status");
      const json = await res.json();
      setState(json.state);
    } catch {}
  }

  async function toggleContinuous(next: boolean) {
    const res = await fetch("/api/agents/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ continuous: next }),
    });
    const json = await res.json();
    setState(json.state);
  }

  async function tick() {
    if (running) return;
    setRunning(true);
    setActivity((p) => [`${new Date().toLocaleTimeString()} tick starting…`, ...p].slice(0, 40));
    try {
      const res = await fetch("/api/agents/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPerTick: 1 }),
      });
      const json = await res.json();
      const tag = json?.result?.picked ?? "?";
      const strat = json?.result?.strategy ?? "?";
      const saved = (json?.result?.results ?? []).filter((r: { status: string }) => r.status === "saved").length;
      setActivity((p) =>
        [`${new Date().toLocaleTimeString()} ${strat} → ${tag} — ${saved} saved`, ...p].slice(0, 40),
      );
      await refresh();
    } catch (e) {
      setActivity((p) => [`${new Date().toLocaleTimeString()} tick failed: ${(e as Error).message}`, ...p]);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!state?.continuous) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    tick();
    timerRef.current = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.continuous]);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Continuous mode</h3>
          <p className="text-xs text-neutral-400 mt-1">
            Back-to-back operation: as soon as one artist is enriched + saved, the next search starts.
            <br />
            Runs server-side — you can close this tab. Stops only if the dev server stops.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={state?.continuous ?? false}
            onChange={(e) => toggleContinuous(e.target.checked)}
          />
          <span className="w-10 h-6 bg-[var(--color-surface)] rounded-full relative peer-checked:bg-[var(--color-accent)] transition">
            <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition peer-checked:translate-x-4" />
          </span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={tick} disabled={running}>
          {running ? "Running…" : "Run one tick now"}
        </button>
        {state?.lastStrategy && (
          <span className="pill mono">last: {state.lastStrategy}</span>
        )}
      </div>

      <div>
        <div className="text-xs text-neutral-400 mb-2">Recent activity</div>
        <div className="mono text-xs space-y-0.5 max-h-48 overflow-auto border border-[var(--color-border)] rounded-md p-3 bg-[var(--color-ink)]">
          {activity.length === 0 ? (
            <div className="text-neutral-500">No ticks yet.</div>
          ) : (
            activity.map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>
      </div>

      {state && state.history.length > 0 && (
        <div>
          <div className="text-xs text-neutral-400 mb-2">Run history</div>
          <div className="space-y-1 max-h-48 overflow-auto">
            {state.history.slice(0, 10).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs gap-2">
                <span className="text-neutral-500 mono">
                  {new Date(h.at).toLocaleTimeString()}
                </span>
                <span className="mono">{h.strategy}</span>
                <span className="text-neutral-400 flex-1 truncate">{h.picked}</span>
                {h.error ? (
                  <span className="text-red-400">err</span>
                ) : (
                  <>
                    <span className="text-green-400">+{h.saved}</span>
                    <span className="text-neutral-500">-{h.skipped}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

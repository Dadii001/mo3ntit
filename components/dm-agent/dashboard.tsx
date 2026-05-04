"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ArtistRow,
  ArtistStatus,
  ConversationRow,
  DmPromptRow,
  Mo3ntitRow,
} from "@/lib/supabase";

const STATUS_LABELS: Record<ArtistStatus, string> = {
  new: "New",
  sent: "Sent",
  needs_offer: "Needs offer",
  offer_sent: "Offer sent",
  won: "Won",
  lost: "Lost",
};

const FUNNEL_STAGE_LABELS: Record<string, string> = {
  hook: "Hook",
  rapport: "Rapport",
  qualify: "Qualify",
  pitch: "Pitch",
  closing: "Closing",
};

const STATUS_PILL: Record<ArtistStatus, string> = {
  new: "pill-live",
  sent: "pill-soon",
  needs_offer: "bg-amber-500/15 border-amber-500/40 text-amber-200",
  offer_sent: "bg-sky-500/15 border-sky-500/40 text-sky-200",
  won: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  lost: "bg-red-500/15 border-red-500/40 text-red-200",
};
import type { ConversationAnalysis, InboxAnalysis } from "@/lib/dm-agent";
import { MACRO_SIGNALS, type MacroSignal } from "@/lib/macro-signals";

type Props = {
  initialPrompts: DmPromptRow[];
};

type LoadedState = {
  artist: ArtistRow;
  mo3ntit: Mo3ntitRow;
  prompt: DmPromptRow;
  history: ConversationRow[];
  alreadySent: boolean;
  matchReason: string;
};

type ResultColor = "neutral" | "green" | "amber" | "red" | "blue";

type ResultEntry = {
  id: string;
  color: ResultColor;
  title: string;
  detail: string;
  timestamp: number;
};

const colorClass: Record<ResultColor, string> = {
  neutral: "bg-neutral-800/40 border-neutral-700 text-neutral-300",
  green: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  amber: "bg-amber-500/15 border-amber-500/40 text-amber-200",
  red: "bg-red-500/15 border-red-500/40 text-red-200",
  blue: "bg-sky-500/15 border-sky-500/40 text-sky-200",
};

function unreadColor(n: number): ResultColor {
  if (n === 0) return "green";
  if (n === 1) return "amber";
  return "red";
}

export function DmAgentDashboard({ initialPrompts }: Props) {
  const [prompts] = useState<DmPromptRow[]>(initialPrompts);
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [dm, setDm] = useState<string>("");
  const [busy, setBusy] = useState<"" | "next" | "regen" | "sent" | "inbox" | "convo">("");
  const [error, setError] = useState<string | null>(null);

  const [inboxResult, setInboxResult] = useState<InboxAnalysis | null>(null);
  const [convoResult, setConvoResult] = useState<{
    analysis: ConversationAnalysis;
    artistFound: boolean;
  } | null>(null);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [todoNext, setTodoNext] = useState<string>(
    "Click Next artist to load a pre-assigned DM.",
  );
  const [preassign, setPreassign] = useState<{
    processed: number;
    total: number;
    phase?: "planning" | "generating";
  } | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [queueHigh, setQueueHigh] = useState<number>(100);
  const [macroSignal, setMacroSignal] = useState<MacroSignal>("idle");
  const [macroOn, setMacroOn] = useState<boolean>(false);
  const [pendingMessages, setPendingMessages] = useState<string[]>([]);
  const prefetchRef = useRef<{
    state: (LoadedState & { dm: string }) | null;
    inFlight: boolean;
    forSkipId: string | null;
  }>({ state: null, inFlight: false, forSkipId: null });

  function paintSignal(s: MacroSignal) {
    setMacroSignal(macroOn ? s : "idle");
  }

  async function refreshQueueCount() {
    try {
      const r = await fetch("/api/dm-agent/queue");
      if (!r.ok) return;
      const arr = (await r.json()) as unknown[];
      setQueueCount(arr.length);
      // bump the "high water mark" so the bar reflects this batch's size
      setQueueHigh((h) => Math.max(h, arr.length, 100));
    } catch {
      /* no-op */
    }
  }

  useEffect(() => {
    refreshQueueCount();
  }, []);

  function pushResult(color: ResultColor, title: string, detail: string) {
    setResults([
      { id: `${Date.now()}-${Math.random()}`, color, title, detail, timestamp: Date.now() },
    ]);
  }

  const activePrompts = prompts.filter((p) => p.is_active);

  function applyLoaded(j: LoadedState & { dm: string }) {
    setLoaded(j);
    setDm(j.dm);
    setPendingMessages([]);
    setTodoNext(
      j.alreadySent
        ? "This artist already received a DM. Review and decide whether to skip."
        : `Send the DM from @${j.mo3ntit.handle} to @${j.artist.account}, then click "Mark sent".`,
    );
    if (!j.alreadySent) paintSignal("send_dm");
  }

  async function fetchOne(
    artistId?: string,
    skipId?: string,
    throwOnError = false,
  ): Promise<(LoadedState & { dm: string }) | null> {
    const params = new URLSearchParams();
    if (artistId) params.set("artistId", artistId);
    if (skipId) params.set("skipId", skipId);
    const r = await fetch(
      `/api/dm-agent/next${params.toString() ? "?" + params.toString() : ""}`,
      { method: "POST" },
    );
    if (!r.ok) {
      if (throwOnError) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return null;
    }
    return (await r.json()) as LoadedState & { dm: string };
  }

  function startPrefetch(currentArtistId: string) {
    const cache = prefetchRef.current;
    if (cache.inFlight || (cache.state && cache.forSkipId === currentArtistId)) return;
    cache.inFlight = true;
    cache.forSkipId = currentArtistId;
    fetchOne(undefined, currentArtistId)
      .then((j) => {
        // Only keep if user hasn't moved on yet
        if (prefetchRef.current.forSkipId === currentArtistId) {
          prefetchRef.current.state = j;
        }
      })
      .catch(() => {
        /* swallow — prefetch is best-effort */
      })
      .finally(() => {
        prefetchRef.current.inFlight = false;
      });
  }

  async function loadNext(artistId?: string) {
    setBusy("next");
    setError(null);
    try {
      // Cache hit: use prefetched payload, then prefetch the next one.
      if (!artistId && prefetchRef.current.state) {
        const cached = prefetchRef.current.state;
        prefetchRef.current.state = null;
        prefetchRef.current.forSkipId = null;
        applyLoaded(cached);
        startPrefetch(cached.artist.id);
        return;
      }

      const j = await fetchOne(artistId, undefined, true);
      if (!j) throw new Error("no artist available");
      applyLoaded(j);
      startPrefetch(j.artist.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function regenerate() {
    if (!loaded) return;
    setBusy("regen");
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artistId: loaded.artist.id,
          mo3ntitId: loaded.mo3ntit.id,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      const j = (await r.json()) as { dm: string; prompt: DmPromptRow };
      setDm(j.dm);
      setLoaded({ ...loaded, prompt: j.prompt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function messageSent() {
    if (!loaded) return;
    setBusy("sent");
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/message-sent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artistId: loaded.artist.id, body: dm }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");

      // Dispense the next chunk if the draft was multi-part.
      if (pendingMessages.length > 0) {
        const [next, ...rest] = pendingMessages;
        setDm(next);
        setPendingMessages(rest);
        setTodoNext(
          `Next chunk — ${rest.length} more queued after this. Send it the same way.`,
        );
        paintSignal("send_reply");
      } else {
        setTodoNext("All chunks sent. Move on or check the inbox.");
        paintSignal("close_next");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function setStatus(status: ArtistStatus) {
    if (!loaded) return;
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artistId: loaded.artist.id, status }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      setLoaded({ ...loaded, artist: { ...loaded.artist, status } });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function markSent() {
    if (!loaded) return;
    setBusy("sent");
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/sent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artistId: loaded.artist.id,
          mo3ntitId: loaded.mo3ntit.id,
          promptId: loaded.prompt.id,
          body: dm,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      setTodoNext("Move on — click Next artist or check the inbox for replies.");
      await refreshQueueCount();
      paintSignal("idle");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runPreassign(limit = 100) {
    if (preassign) return;
    setError(null);
    setPreassign({ processed: 0, total: limit });
    try {
      const res = await fetch(`/api/dm-agent/preassign?limit=${limit}`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error(`preassign ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as
            | { type: "start"; total: number }
            | {
                type: "phase";
                phase: "planning" | "generating";
                processed: number;
                total: number;
              }
            | { type: "planned"; handle: string; mo3ntit: string; promptName: string }
            | {
                type: "done";
                handle: string;
                mo3ntit: string;
                promptName: string;
                dmPreview: string;
              }
            | { type: "fail"; handle: string; error: string }
            | { type: "summary"; ok: number; failed: number; total: number; message?: string }
            | { type: "error"; message: string };
          if (evt.type === "start") {
            setPreassign({ processed: 0, total: evt.total });
          } else if (evt.type === "phase") {
            setPreassign({ processed: evt.processed, total: evt.total, phase: evt.phase });
          } else if (evt.type === "error") {
            setError(evt.message);
          }
          // "done", "fail", "planned", "summary" events are intentionally ignored —
          // result inbox is reserved for inbox/conversation analyzer outcomes.
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreassign(null);
      await refreshQueueCount();
    }
  }

  async function handleInboxImage(base64: string) {
    setBusy("inbox");
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      const j = (await r.json()) as InboxAnalysis;
      setInboxResult(j);
      const c = unreadColor(j.unreadCount);
      pushResult(
        c,
        j.unreadCount === 0
          ? "Inbox clear"
          : j.unreadCount === 1
            ? "1 unread message"
            : `${j.unreadCount} unread messages`,
        j.threads.length > 0
          ? j.threads.map((t) => t.handle ?? t.nickname ?? "?").join(", ")
          : "No unread threads visible.",
      );
      setTodoNext(
        j.unreadCount === 0
          ? "Nothing to reply to — load the next artist."
          : `Open ${j.threads[0]?.handle ?? "the unread thread"} and paste the conversation screenshot below.`,
      );
      // Macro: route depending on unread count
      paintSignal(j.unreadCount === 0 ? "close_next" : "open_thread");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function handleConvoImage(base64: string) {
    setBusy("convo");
    setError(null);
    try {
      const r = await fetch("/api/dm-agent/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mo3ntitId: loaded?.mo3ntit.id ?? null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      const j = (await r.json()) as {
        analysis: ConversationAnalysis;
        artist: ArtistRow | null;
        mo3ntit: Mo3ntitRow | null;
        draft: string | null;
        messages?: string[];
        history?: ConversationRow[];
        warning?: string;
        note?: string;
        createdArtist?: boolean;
        stageBefore?: string;
        stageAfter?: string;
        stageRationale?: string;
        stageAdvanced?: boolean;
        statusBumped?: boolean;
      };
      setConvoResult({ analysis: j.analysis, artistFound: !!j.artist });

      if (j.createdArtist && j.artist) {
        pushResult(
          "amber",
          `Added @${j.artist.account} to DB`,
          "Artist wasn't in the database — pulled their profile from TikTok and saved a minimal record.",
        );
      }

      if (j.artist && j.draft) {
        const promptForState = loaded?.prompt ?? activePrompts[0] ?? prompts[0];
        if (promptForState) {
          setLoaded({
            artist: j.artist,
            mo3ntit: j.mo3ntit ?? loaded?.mo3ntit ?? ({} as Mo3ntitRow),
            prompt: promptForState,
            history: j.history ?? [],
            alreadySent: !!j.artist.first_dm_sent_at,
            matchReason: "carried from existing conversation",
          });
        }
        const allMessages = j.messages && j.messages.length > 0 ? j.messages : [j.draft];
        setDm(allMessages[0]);
        setPendingMessages(allMessages.slice(1));
        const stageNote = j.stageAdvanced
          ? `${FUNNEL_STAGE_LABELS[j.stageBefore ?? ""] ?? j.stageBefore} → ${
              FUNNEL_STAGE_LABELS[j.stageAfter ?? ""] ?? j.stageAfter
            }${j.statusBumped ? " · flagged Needs offer" : ""}`
          : `Stage ${FUNNEL_STAGE_LABELS[j.stageAfter ?? ""] ?? j.stageAfter}`;
        pushResult(
          j.statusBumped ? "amber" : "blue",
          `Reply drafted for @${j.artist.account} · ${stageNote}`,
          `${j.draft.length > 140 ? j.draft.slice(0, 140) + "..." : j.draft}${
            j.stageRationale ? ` — ${j.stageRationale}` : ""
          }`,
        );
        setTodoNext(
          j.statusBumped
            ? `Send the reply, then send the offer link manually — status is already Needs offer.`
            : `Review the draft, copy it, send it, then click "Mark sent".`,
        );
        // Macro: send the drafted reply
        paintSignal("send_reply");
      } else if (j.warning) {
        pushResult("amber", "Could not match artist", j.warning);
        setTodoNext("Find this artist manually or add them to the DB.");
      } else if (j.note) {
        pushResult("amber", "Nothing to reply to", j.note);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          className={preassign ? "btn" : "btn-ghost"}
          onClick={() => runPreassign(100)}
          disabled={!!preassign || activePrompts.length === 0}
        >
          {preassign ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {preassign.phase === "generating" ? "Generating" : "Matching"}{" "}
              {preassign.processed}/{preassign.total}
            </span>
          ) : (
            "Pre-assign next 100"
          )}
        </button>
        {preassign && (
          <div className="flex-1 max-w-md h-2 bg-[var(--color-surface)] rounded overflow-hidden border border-[var(--color-border)]">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{
                width: `${preassign.total ? (preassign.processed / preassign.total) * 100 : 0}%`,
              }}
            />
          </div>
        )}
        {preassign && (
          <span className="text-xs text-emerald-300 mono">
            {preassign.total - preassign.processed} left
          </span>
        )}
        {!preassign && activePrompts.length === 0 && (
          <span className="text-xs text-amber-300">
            Activate a prompt in settings before pre-assigning.
          </span>
        )}

        {!preassign && queueCount !== null && (
          <QueueGauge count={queueCount} high={queueHigh} />
        )}

        {error && <div className="text-xs text-red-300 truncate">{error}</div>}
      </div>

      <div className="dm-grid">
        <ArtistColumn
          loaded={loaded}
          dm={dm}
          setDm={setDm}
          onNext={() => loadNext()}
          onRegenerate={regenerate}
          onMarkSent={markSent}
          onMessageSent={messageSent}
          onStatusChange={setStatus}
          busy={busy}
          pendingMessagesCount={pendingMessages.length}
        />

        <AnalyzerColumn
          onInbox={handleInboxImage}
          onConvo={handleConvoImage}
          busy={busy}
          inboxResult={inboxResult}
          convoResult={convoResult}
          todoNext={todoNext}
        />

        <ResultInboxColumn
          results={results}
          onClear={() => setResults([])}
          macroSignal={macroSignal}
          macroOn={macroOn}
          onMacroToggle={(v) => {
            setMacroOn(v);
            if (!v) setMacroSignal("idle");
          }}
        />
      </div>
    </>
  );
}

function ArtistColumn({
  loaded,
  dm,
  setDm,
  onNext,
  onRegenerate,
  onMarkSent,
  onMessageSent,
  onStatusChange,
  busy,
  pendingMessagesCount,
}: {
  loaded: LoadedState | null;
  dm: string;
  setDm: (v: string) => void;
  onNext: () => void;
  onRegenerate: () => void;
  onMarkSent: () => void;
  onMessageSent: () => void;
  onStatusChange: (s: ArtistStatus) => void;
  busy: string;
  pendingMessagesCount: number;
}) {
  const status = (loaded?.artist.status as ArtistStatus | null) ?? (loaded?.alreadySent ? "sent" : "new");
  const firstDmDone = !!loaded?.alreadySent;
  return (
    <div className="dm-col card p-5 flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-400">
          Artist
        </h2>
        <button className="btn" onClick={onNext} disabled={busy === "next"}>
          {busy === "next" ? "Loading..." : loaded ? "Next artist" : "Load next"}
        </button>
      </div>

      {!loaded ? (
        <div className="text-sm text-neutral-500 flex-1 flex items-center justify-center text-center">
          Click <span className="mono mx-1">Load next</span> to start.
        </div>
      ) : (
        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
          {/* Artist card — click to copy TikTok link */}
          <CopyOnClick value={loaded.artist.tiktok_profile} hint="Copy TikTok link">
            <div className="flex items-center gap-3">
              {loaded.artist.avatar_url ? (
                <img
                  src={loaded.artist.avatar_url}
                  alt={loaded.artist.nickname}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-cover border border-[var(--color-border)] shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[var(--color-surface)] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base truncate">{loaded.artist.nickname}</div>
                <div className="mono text-xs text-neutral-500 truncate">
                  @{loaded.artist.account}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`pill ${STATUS_PILL[status]}`}>
                  {STATUS_LABELS[status]}
                </span>
                {loaded.artist.funnel_stage && (
                  <span className="text-[10px] mono text-neutral-500">
                    funnel: {FUNNEL_STAGE_LABELS[loaded.artist.funnel_stage] ?? loaded.artist.funnel_stage}
                  </span>
                )}
              </div>
            </div>
          </CopyOnClick>

          {/* Mo3ntit card — click to copy handle */}
          <CopyOnClick value={`@${loaded.mo3ntit.handle}`} hint="Copy mo3ntit handle">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-neutral-500 mono shrink-0">SEND FROM</span>
              {loaded.mo3ntit.avatar_url ? (
                <img
                  src={loaded.mo3ntit.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full object-cover shrink-0 border border-[var(--color-border)]"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[var(--color-surface)] shrink-0" />
              )}
              <span className="mono text-sm font-semibold text-[var(--color-accent)] truncate">
                @{loaded.mo3ntit.handle}
              </span>
            </div>
          </CopyOnClick>

          {/* DM card — click anywhere on the box to copy, textarea is editable */}
          <CopyOnClick value={dm} hint="Click to copy DM" stopOnInteractive>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-500 mono">DM</span>
                <span className="text-[10px] text-neutral-600 normal-case tracking-normal">
                  via {loaded.prompt.name}
                </span>
              </div>
              <textarea
                className="input !p-2 !text-sm"
                rows={6}
                value={dm}
                onChange={(e) => setDm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </CopyOnClick>

          <div className="flex gap-2 mt-1">
            <button
              className="btn-ghost flex-1"
              onClick={() => onRegenerate()}
              disabled={busy === "regen"}
            >
              {busy === "regen" ? "..." : "Regenerate"}
            </button>
            {firstDmDone ? (
              <button
                className="btn flex-1"
                onClick={onMessageSent}
                disabled={busy === "sent" || !dm.trim()}
                title="Log this message + dispense the next chunk if more were drafted"
              >
                {busy === "sent"
                  ? "..."
                  : pendingMessagesCount > 0
                    ? `Message sent (${pendingMessagesCount} more)`
                    : "Message sent"}
              </button>
            ) : (
              <button
                className="btn flex-1"
                onClick={onMarkSent}
                disabled={busy === "sent" || !dm.trim()}
                title="First DM only — log + flip status to Sent + sync Monday"
              >
                {busy === "sent" ? "Saving..." : "Mark sent"}
              </button>
            )}
          </div>

          {/* Pipeline actions — appear once first DM is sent */}
          {(status === "sent" ||
            status === "needs_offer" ||
            status === "offer_sent") && (
            <div className="border-t border-[var(--color-border)] pt-3 mt-1">
              <div className="label !mb-2">Pipeline</div>
              <div className="grid grid-cols-2 gap-2">
                {status === "sent" && (
                  <button
                    className="btn-ghost !text-xs col-span-2"
                    onClick={() => onStatusChange("needs_offer")}
                  >
                    Mark needs offer
                  </button>
                )}
                {status === "needs_offer" && (
                  <button
                    className="btn-ghost !text-xs col-span-2"
                    onClick={() => onStatusChange("offer_sent")}
                  >
                    Mark offer sent
                  </button>
                )}
                {status === "offer_sent" && (
                  <button
                    className="btn-ghost !text-xs"
                    onClick={() => onStatusChange("won")}
                  >
                    Won
                  </button>
                )}
                <button
                  className="btn-ghost !text-xs text-red-300"
                  onClick={() => onStatusChange("lost")}
                >
                  Lost
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyOnClick({
  value,
  hint,
  children,
  stopOnInteractive,
}: {
  value: string;
  hint: string;
  children: React.ReactNode;
  stopOnInteractive?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      title={hint}
      onClick={(e) => {
        if (
          stopOnInteractive &&
          (e.target as HTMLElement).closest("textarea, input, button")
        ) {
          return;
        }
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
      className={`relative rounded-lg border p-3 cursor-pointer transition-colors ${
        copied
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)]/40"
      }`}
    >
      {children}
      {copied && (
        <span className="absolute top-2 right-2 text-[10px] mono text-emerald-300">
          ✓ copied
        </span>
      )}
    </div>
  );
}

function AnalyzerColumn({
  onInbox,
  onConvo,
  busy,
  inboxResult,
  convoResult,
  todoNext,
}: {
  onInbox: (base64: string) => void;
  onConvo: (base64: string) => void;
  busy: string;
  inboxResult: InboxAnalysis | null;
  convoResult: { analysis: ConversationAnalysis; artistFound: boolean } | null;
  todoNext: string;
}) {
  return (
    <div className="dm-col card p-5 flex flex-col gap-4 overflow-hidden">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-400">
        Analyze
      </h2>

      <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto pr-1">
        <PasteDrop
          label="Inbox checker"
          hint="Click here, then paste (Ctrl/⌘+V) a screenshot of your full inbox"
          onImage={onInbox}
          busy={busy === "inbox"}
        />
        {inboxResult && (
          <div className="text-xs text-neutral-400 leading-snug">
            {inboxResult.threads.length === 0
              ? "No unread."
              : inboxResult.threads
                  .map((t) => t.handle ?? t.nickname ?? "?")
                  .join(" · ")}
          </div>
        )}

        <PasteDrop
          label="Conversation analyzer"
          hint="Click here, then paste a screenshot of one DM thread"
          onImage={onConvo}
          busy={busy === "convo"}
        />
        {convoResult && !convoResult.artistFound && (
          <div className="text-xs text-amber-300">
            Artist not in DB — handle:{" "}
            {convoResult.analysis.artistHandle ?? "(unreadable)"}
          </div>
        )}

        <Field label="To do next">
          <p className="text-sm text-neutral-200 leading-relaxed">{todoNext}</p>
        </Field>
      </div>
    </div>
  );
}

function ResultInboxColumn({
  results,
  onClear,
  macroSignal,
  macroOn,
  onMacroToggle,
}: {
  results: ResultEntry[];
  onClear: () => void;
  macroSignal: MacroSignal;
  macroOn: boolean;
  onMacroToggle: (v: boolean) => void;
}) {
  const sig = MACRO_SIGNALS[macroSignal];
  return (
    <div className="dm-col card p-5 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-400">
          Result inbox
        </h2>
        {results.length > 0 && (
          <button className="btn-ghost !py-0.5 !px-2 !text-[11px]" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {/* Macro signal swatch — Macro Commander samples this pixel */}
      <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-ink)]">
        <div
          id="macro-signal"
          className="w-24 h-24 rounded-md border border-white/10 shrink-0"
          style={{ backgroundColor: sig.color }}
          aria-label={`Macro signal: ${sig.label}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase mono tracking-wider text-neutral-500">
              Macro signal
            </span>
            <label className="flex items-center gap-1 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={macroOn}
                onChange={(e) => onMacroToggle(e.target.checked)}
              />
              <span className={macroOn ? "text-emerald-300" : "text-neutral-500"}>
                {macroOn ? "ON" : "OFF"}
              </span>
            </label>
          </div>
          <div className="text-sm font-semibold">{sig.label}</div>
          <div className="text-[10px] text-neutral-500 mono">{sig.color}</div>
          <div className="text-[11px] text-neutral-400 leading-snug mt-1">{sig.hint}</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-3">
        {results.length === 0 ? (
          <div className="text-sm text-neutral-500">
            Results from inbox checks, conversation analyses, and sent DMs will appear here.
          </div>
        ) : (
          results.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              <div className={`rounded-lg border p-3 ${colorClass[r.color]}`}>
                <div className="text-sm font-semibold">{r.title}</div>
              </div>
              <div className="text-xs text-neutral-300 leading-snug px-1">{r.detail}</div>
              <div className="text-[10px] text-neutral-500 px-1">
                {new Date(r.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function PasteDrop({
  label,
  hint,
  onImage,
  busy,
}: {
  label: string;
  hint: string;
  onImage: (base64: string) => void;
  busy: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = async (e: ClipboardEvent) => {
      if (!el.contains(document.activeElement)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          e.preventDefault();
          const blob = it.getAsFile();
          if (!blob) continue;
          const buf = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(buf);
          setPreview(`data:${it.type};base64,${base64}`);
          onImage(base64);
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [onImage]);

  return (
    <div>
      <div className="label">{label}</div>
      <div
        ref={ref}
        tabIndex={0}
        className="rounded-lg border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] focus:border-[var(--color-accent)] focus:outline-none p-4 text-center text-sm text-neutral-400 cursor-text min-h-[100px] flex items-center justify-center"
      >
        {busy ? (
          "Analyzing..."
        ) : preview ? (
          <img src={preview} alt="" className="max-h-24 rounded" />
        ) : (
          hint
        )}
      </div>
    </div>
  );
}

function QueueGauge({ count, high }: { count: number; high: number }) {
  const pct = Math.max(0, Math.min(100, (count / high) * 100));
  const color =
    count === 0
      ? "bg-red-500"
      : count <= 10
        ? "bg-amber-500"
        : count <= 30
          ? "bg-sky-500"
          : "bg-emerald-500";
  const textColor =
    count === 0
      ? "text-red-300"
      : count <= 10
        ? "text-amber-300"
        : "text-neutral-300";
  return (
    <div className="flex items-center gap-2 ml-auto">
      <span className={`text-xs mono ${textColor}`}>
        {count === 0 ? "Queue empty — pre-assign more" : `${count} left in queue`}
      </span>
      <div className="w-32 h-2 bg-[var(--color-surface)] rounded overflow-hidden border border-[var(--color-border)]">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

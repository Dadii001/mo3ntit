"use client";

import Link from "next/link";
import { useState } from "react";
import type { QueueRow } from "@/lib/supabase";

export function BoardCards({ queue }: { queue: QueueRow[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {queue.map((q) => (
        <BoardCard key={q.id} q={q} />
      ))}
    </div>
  );
}

function BoardCard({ q }: { q: QueueRow }) {
  return (
    <div className="card p-4 flex flex-col gap-3">
      {/* Artist */}
      <CopyBlock value={q.tiktok_profile} hint="Copy TikTok link">
        <div className="flex items-center gap-3">
          {q.avatar_url ? (
            <img
              src={q.avatar_url}
              alt=""
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full object-cover border border-[var(--color-border)] shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[var(--color-surface)] shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{q.nickname}</div>
            <div className="mono text-xs text-neutral-500 truncate">@{q.account}</div>
          </div>
        </div>
      </CopyBlock>

      <div className="text-center text-neutral-500 text-xs leading-none">↓</div>

      {/* Mo3ntit */}
      <CopyBlock value={`@${q.mo3ntit_handle}`} hint="Copy mo3ntit handle">
        <div className="flex items-center gap-3">
          {q.mo3ntit_avatar ? (
            <img
              src={q.mo3ntit_avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-[var(--color-border)] shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[var(--color-surface)] shrink-0" />
          )}
          <span className="mono text-sm font-semibold text-[var(--color-accent)] truncate">
            @{q.mo3ntit_handle}
          </span>
        </div>
      </CopyBlock>

      {/* DM */}
      <CopyBlock value={q.current_dm} hint="Copy DM">
        <div className="text-xs label !mb-1.5 flex items-center justify-between">
          <span>DM</span>
          <span className="text-[10px] text-neutral-500 normal-case tracking-normal">
            click to copy
          </span>
        </div>
        <p className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">
          {q.current_dm}
        </p>
      </CopyBlock>

      <Link
        href={`/agents/first-dm?artistId=${q.id}`}
        className="btn-ghost text-center mt-1"
      >
        Open in DM Agent
      </Link>
    </div>
  );
}

function CopyBlock({
  value,
  hint,
  children,
}: {
  value: string;
  hint: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
      title={hint}
      className={`relative text-left rounded-lg border p-3 transition-all ${
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
    </button>
  );
}

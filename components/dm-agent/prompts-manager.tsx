"use client";

import { useState } from "react";
import type { DmPromptRow } from "@/lib/supabase";

export function PromptsManager({
  initial,
  defaultTemplate,
}: {
  initial: DmPromptRow[];
  defaultTemplate: string;
}) {
  const [prompts, setPrompts] = useState<DmPromptRow[]>(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refetch() {
    const r = await fetch("/api/dm-agent/prompts");
    if (r.ok) {
      const j = (await r.json()) as { prompts: DmPromptRow[] };
      setPrompts(j.prompts);
    }
  }

  async function toggleActive(p: DmPromptRow) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/dm-agent/prompts/${p.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: DmPromptRow) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/dm-agent/prompts/${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="card p-3 text-sm text-red-300 border-red-500/40">{error}</div>}

      <div className="flex justify-end">
        <button className="btn" onClick={() => setEditing("new")} disabled={busy}>
          + New angle
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {prompts.length === 0 ? (
          <div className="card p-6 text-center text-sm text-neutral-500 col-span-2">
            No prompts yet. Create your first angle.
          </div>
        ) : (
          prompts.map((p) => (
            <div key={p.id} className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{p.name}</div>
                <span className={`pill ${p.is_active ? "pill-live" : ""}`}>
                  {p.is_active ? "Active" : "Off"}
                </span>
              </div>
              {p.description && (
                <p className="text-xs text-neutral-400">{p.description}</p>
              )}
              <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto bg-[var(--color-ink)] rounded p-2 border border-[var(--color-border)]">
                {p.template}
              </pre>
              <div className="flex items-center justify-between text-[11px] text-neutral-500">
                <span>Used {p.uses}x</span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost !py-1 !px-2 !text-[11px]"
                    onClick={() => toggleActive(p)}
                    disabled={busy}
                  >
                    {p.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="btn-ghost !py-1 !px-2 !text-[11px]"
                    onClick={() => setEditing(p.id)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-ghost !py-1 !px-2 !text-[11px]"
                    onClick={() => remove(p)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {editing && (
        <PromptEditor
          initial={
            editing === "new"
              ? null
              : prompts.find((p) => p.id === editing) ?? null
          }
          defaultTemplate={defaultTemplate}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

function PromptEditor({
  initial,
  defaultTemplate,
  onClose,
  onSaved,
}: {
  initial: DmPromptRow | null;
  defaultTemplate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [template, setTemplate] = useState(initial?.template ?? defaultTemplate);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const url = initial
        ? `/api/dm-agent/prompts/${initial.id}`
        : "/api/dm-agent/prompts";
      const method = initial ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, template, is_active: isActive }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card p-5 w-full max-w-2xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{initial ? "Edit angle" : "New angle"}</h3>
          <button className="btn-ghost !py-1 !px-2" onClick={onClose}>
            Close
          </button>
        </div>

        {err && <div className="text-xs text-red-300">{err}</div>}

        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. compliment-and-connect"
          />
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <input
            className="input"
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What makes this angle different"
          />
        </div>
        <div>
          <label className="label">Template</label>
          <textarea
            className="input mono"
            rows={14}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (eligible for random pick)
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={busy || !name || !template}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { listMo3ntitin, type Mo3ntitRow } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function genderClass(gender: string | null): string {
  switch (gender) {
    case "male":
      return "bg-blue-500/15 border-blue-500/30 text-blue-300";
    case "female":
      return "bg-pink-500/15 border-pink-500/30 text-pink-300";
    case "non-binary":
      return "bg-purple-500/15 border-purple-500/30 text-purple-300";
    case "group":
      return "bg-amber-500/15 border-amber-500/30 text-amber-300";
    default:
      return "bg-neutral-500/15 border-neutral-500/30 text-neutral-300";
  }
}

function CreatorCard({ c }: { c: Mo3ntitRow }) {
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {c.avatar_url ? (
          <img
            src={c.avatar_url}
            alt={c.nickname ?? c.handle}
            className="w-12 h-12 rounded-full object-cover border border-[var(--color-border)]"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)]" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{c.nickname || c.handle}</span>
            {c.verified && (
              <span className="text-[10px] text-blue-400" title="Verified">●</span>
            )}
            <span
              className={`pill ${genderClass(c.gender)}`}
              style={{ textTransform: "capitalize" }}
            >
              {c.gender ?? "unknown"}
            </span>
          </div>
          <a
            href={c.profile_url}
            target="_blank"
            rel="noreferrer"
            className="mono text-neutral-400 hover:text-white"
          >
            @{c.handle}
          </a>
        </div>
      </div>

      {c.vibe && (
        <div className="text-sm">
          <span className="label">Vibe</span>
          <div className="text-[var(--color-accent)] italic">"{c.vibe}"</div>
        </div>
      )}

      {c.description && (
        <div className="text-sm leading-relaxed text-neutral-200">{c.description}</div>
      )}

      {c.style_tags && c.style_tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {c.style_tags.map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-[var(--color-border)]">
        <div>
          <span className="label">Followers</span>
          <div className="font-semibold">{formatNumber(c.followers)}</div>
        </div>
        <div>
          <span className="label">Likes</span>
          <div className="font-semibold">{formatNumber(c.total_likes)}</div>
        </div>
        <div>
          <span className="label">Videos</span>
          <div className="font-semibold">{formatNumber(c.video_count)}</div>
        </div>
      </div>

      {(c.region || c.content_language) && (
        <div className="flex gap-2 text-xs text-neutral-400">
          {c.region && <span>📍 {c.region}</span>}
          {c.content_language && (
            <span style={{ textTransform: "uppercase" }}>🌐 {c.content_language}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default async function Mo3ntitinPage() {
  let creators: Mo3ntitRow[] = [];
  let error: string | null = null;
  try {
    creators = await listMo3ntitin();
  } catch (e) {
    error = (e as Error).message;
  }

  const counts = creators.reduce<Record<string, number>>((acc, c) => {
    const k = c.gender ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mo3ntitin</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Roster of TikTok creators sending DMs to artists. Descriptions generated from frame
          screenshots of each creator's recent videos.
        </p>
      </div>

      {error ? (
        <div className="card p-5 text-sm">
          <div className="text-red-400 font-semibold mb-1">Supabase fetch failed</div>
          <div className="mono text-neutral-400">{error}</div>
        </div>
      ) : creators.length === 0 ? (
        <div className="card p-6 text-center text-neutral-500 text-sm">
          No creators yet. POST to <span className="mono">/api/mo3ntitin/seed</span> to populate.
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap text-xs">
            <span className="pill">{creators.length} total</span>
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([gender, n]) => (
                <span key={gender} className={`pill ${genderClass(gender)}`} style={{ textTransform: "capitalize" }}>
                  {gender} · {n}
                </span>
              ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {creators.map((c) => (
              <CreatorCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

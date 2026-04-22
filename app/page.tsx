import Link from "next/link";
import { AGENTS } from "@/lib/agents/registry";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Your roster of autonomous workers. Discovery is live; the rest are wired and coming.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AGENTS.map((a) => (
          <div key={a.id} className="card p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="text-xs text-neutral-500 mb-1">{a.tagline}</div>
                <h2 className="text-lg font-semibold">{a.name}</h2>
              </div>
              <span className={a.status === "live" ? "pill pill-live" : "pill pill-soon"}>
                {a.status === "live" ? "Live" : "Soon"}
              </span>
            </div>
            <p className="text-sm text-neutral-400 mb-4 flex-1">{a.description}</p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {a.tools.map((t) => (
                <span key={t} className="pill mono">{t}</span>
              ))}
            </div>
            {a.status === "live" ? (
              <Link href={`/agents/${a.id}`} className="btn text-center">
                Open
              </Link>
            ) : (
              <button className="btn-ghost cursor-not-allowed" disabled>
                Coming soon
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

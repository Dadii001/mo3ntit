import { listRecentArtists } from "@/lib/monday";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let artists: Awaited<ReturnType<typeof listRecentArtists>> = [];
  let error: string | null = null;
  try {
    artists = await listRecentArtists(50);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Live view of the Monday board. Artists saved by the discovery agent land here.
        </p>
      </div>

      {error ? (
        <div className="card p-5 text-sm">
          <div className="text-red-400 font-semibold mb-1">Monday fetch failed</div>
          <div className="mono text-neutral-400">{error}</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface)] text-neutral-400 text-left">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Handle</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Sent</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {artists.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-neutral-500">
                    No artists yet. Run the Discovery Agent.
                  </td>
                </tr>
              ) : (
                artists.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--color-border)]">
                    <td className="p-3">{a.name}</td>
                    <td className="p-3 mono">@{a.account}</td>
                    <td className="p-3">{a.status || "—"}</td>
                    <td className="p-3 text-neutral-400">{a.sentDate || "—"}</td>
                    <td className="p-3 text-right">
                      {a.profileUrl && (
                        <a
                          className="btn-ghost"
                          href={a.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          TikTok
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

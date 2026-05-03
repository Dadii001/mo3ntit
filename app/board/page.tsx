import Link from "next/link";
import { BoardCards } from "@/components/dm-agent/board-cards";
import { listAssignedQueue } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let queue: Awaited<ReturnType<typeof listAssignedQueue>> = [];
  let error: string | null = null;
  try {
    queue = await listAssignedQueue();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Pre-assigned artists waiting for their first DM. Click any block on a card to copy
            it — TikTok link, mo3ntit handle, or the full DM.
          </p>
        </div>
        <Link href="/agents/first-dm" className="btn">
          Open DM Agent
        </Link>
      </div>

      {error ? (
        <div className="card p-5 text-sm">
          <div className="text-red-400 font-semibold mb-1">Supabase fetch failed</div>
          <div className="mono text-neutral-400">{error}</div>
        </div>
      ) : queue.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">
          Queue is empty. Open the{" "}
          <Link href="/agents/first-dm" className="underline">
            DM Agent
          </Link>{" "}
          and click <span className="mono">Pre-assign next 100</span> to fill it.
        </div>
      ) : (
        <>
          <div className="text-xs text-neutral-500">{queue.length} pre-assigned</div>
          <BoardCards queue={queue} />
        </>
      )}
    </div>
  );
}

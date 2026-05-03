import Link from "next/link";
import { listPrompts } from "@/lib/supabase";
import { PromptsManager } from "@/components/dm-agent/prompts-manager";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/dm-agent";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  let prompts: Awaited<ReturnType<typeof listPrompts>> = [];
  let error: string | null = null;
  try {
    prompts = await listPrompts();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/agents/first-dm" className="text-xs text-neutral-500 hover:text-white">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">DM prompt angles</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Each prompt is a different angle for the first DM. Toggle multiple{" "}
          <span className="mono">active</span> to A/B test — the agent randomly picks among active
          prompts each generation.
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          Available placeholders: <span className="mono">{"{{artist_nickname}}"}</span>,{" "}
          <span className="mono">{"{{artist_handle}}"}</span>,{" "}
          <span className="mono">{"{{artist_brief}}"}</span>,{" "}
          <span className="mono">{"{{song_brief}}"}</span>,{" "}
          <span className="mono">{"{{song_name}}"}</span>,{" "}
          <span className="mono">{"{{song_language}}"}</span>,{" "}
          <span className="mono">{"{{mo3ntit_handle}}"}</span>,{" "}
          <span className="mono">{"{{mo3ntit_nickname}}"}</span>,{" "}
          <span className="mono">{"{{mo3ntit_description}}"}</span>,{" "}
          <span className="mono">{"{{mo3ntit_vibe}}"}</span>,{" "}
          <span className="mono">{"{{mo3ntit_gender}}"}</span>.
        </p>
      </div>

      {error ? (
        <div className="card p-4 text-sm text-red-300">{error}</div>
      ) : (
        <PromptsManager initial={prompts} defaultTemplate={DEFAULT_PROMPT_TEMPLATE} />
      )}
    </div>
  );
}

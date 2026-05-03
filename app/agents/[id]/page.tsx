import Link from "next/link";
import { notFound } from "next/navigation";
import { ContinuousPanel } from "@/components/continuous-panel";
import { DiscoveryRunner } from "@/components/discovery-runner";
import { DmAgentDashboard } from "@/components/dm-agent/dashboard";
import { getAgent } from "@/lib/agents/registry";
import { listPrompts } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();

  if (agent.id === "first-dm") {
    let prompts: Awaited<ReturnType<typeof listPrompts>> = [];
    let bootError: string | null = null;
    try {
      prompts = await listPrompts();
    } catch (e) {
      bootError = (e as Error).message;
    }

    return (
      <div className="dm-page space-y-3">
        <div className="flex items-center justify-between gap-4 flex-shrink-0">
          <div>
            <Link href="/" className="text-xs text-neutral-500 hover:text-white">← All agents</Link>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
              <span className="pill pill-live">Live</span>
              <Link
                href="/agents/first-dm/prompts"
                className="text-xs text-neutral-400 hover:text-white"
              >
                Manage prompts ({prompts.filter((p) => p.is_active).length} active)
              </Link>
            </div>
          </div>
        </div>

        {bootError ? (
          <div className="card p-4 text-sm text-red-300">{bootError}</div>
        ) : prompts.length === 0 ? (
          <div className="card p-4 text-sm">
            No prompts yet.{" "}
            <Link href="/agents/first-dm/prompts" className="underline">
              Create your first prompt angle
            </Link>{" "}
            to start generating DMs.
          </div>
        ) : (
          <DmAgentDashboard initialPrompts={prompts} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-neutral-500 hover:text-white">← All agents</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <span className={agent.status === "live" ? "pill pill-live" : "pill pill-soon"}>
            {agent.status === "live" ? "Live" : "Coming soon"}
          </span>
        </div>
        <p className="text-sm text-neutral-400 mt-1 max-w-3xl">{agent.description}</p>
      </div>

      {agent.id === "discovery" ? (
        <div className="space-y-6">
          <ContinuousPanel />
          <DiscoveryRunner />
        </div>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-neutral-400">This agent isn&apos;t running yet. Its tools and slot are reserved.</p>
        </div>
      )}
    </div>
  );
}

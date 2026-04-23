import Link from "next/link";
import { notFound } from "next/navigation";
import { ContinuousPanel } from "@/components/continuous-panel";
import { DiscoveryRunner } from "@/components/discovery-runner";
import { getAgent } from "@/lib/agents/registry";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();

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

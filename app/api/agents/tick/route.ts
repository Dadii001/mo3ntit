import { runTick } from "@/lib/agents/strategies";
import type { DiscoveryEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function runOnce(
  body: { maxPerTick?: number; strategy?: "hashtag-rotation" | "related-following" | "music-explore" },
  logs: string[],
): Promise<unknown> {
  const emit = (e: DiscoveryEvent) => {
    if (e.type === "log") logs.push(`${new Date().toISOString()} ${e.level} ${e.message}`);
  };
  return runTick({ maxPerTick: body.maxPerTick ?? 1, strategy: body.strategy }, emit);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const logs: string[] = [];
  const result = await runOnce(body, logs);
  return Response.json({ ok: true, logs, result });
}

export async function GET(req: Request) {
  // Vercel Cron triggers GET; accept it too.
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const logs: string[] = [];
  const result = await runOnce({ maxPerTick: 1 }, logs);
  return Response.json({ ok: true, logs, result });
}

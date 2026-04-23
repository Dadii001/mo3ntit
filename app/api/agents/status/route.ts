import { loadState, setContinuous } from "@/lib/agents/state";

export const runtime = "nodejs";

export async function GET() {
  const state = await loadState();
  return Response.json({ state });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { continuous?: boolean };
  if (typeof body.continuous !== "boolean") {
    return Response.json({ error: "continuous must be boolean" }, { status: 400 });
  }
  const state = await setContinuous(body.continuous);
  return Response.json({ state });
}

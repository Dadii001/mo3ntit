import { NextResponse } from "next/server";
import {
  FUNNEL_STAGES,
  maybeFollowUp,
  type FunnelStage,
} from "@/lib/dm-agent";
import {
  getArtistById,
  getMo3ntitById,
  listConversation,
  logConversation,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { artistId: string; body: string };
    if (!body.artistId || !body.body?.trim()) {
      return NextResponse.json({ error: "artistId and body required" }, { status: 400 });
    }

    const artist = await getArtistById(body.artistId);
    if (!artist) {
      return NextResponse.json({ error: "artist not found" }, { status: 404 });
    }

    // Refuse to follow-up the very first DM. The first DM is always one message;
    // the user should hit "Mark sent" for that, not "Message sent".
    if (!artist.first_dm_sent_at) {
      return NextResponse.json(
        { error: "first DM not yet marked sent — use Mark sent for the first message" },
        { status: 400 },
      );
    }

    // Dedupe: if the last outbound logged equals this body, don't re-insert.
    const existing = await listConversation(artist.id);
    const last = existing.at(-1);
    const alreadyLogged =
      last && last.direction === "out" && last.body.trim() === body.body.trim();

    if (!alreadyLogged) {
      await logConversation({
        artistId: artist.id,
        mo3ntitId: artist.selected_mo3ntit_id,
        direction: "out",
        body: body.body,
        promptId: artist.last_prompt_id ?? null,
        source: "manual",
      });
    }

    const fullHistory = await listConversation(artist.id);
    const stage = (FUNNEL_STAGES as readonly string[]).includes(artist.funnel_stage ?? "")
      ? (artist.funnel_stage as FunnelStage)
      : "rapport";

    const mo3ntit = artist.selected_mo3ntit_id
      ? await getMo3ntitById(artist.selected_mo3ntit_id)
      : null;

    const followUp = await maybeFollowUp({
      artist,
      mo3ntit,
      history: fullHistory.map((m) => ({ direction: m.direction, body: m.body })),
      stage,
      justSent: body.body,
    });

    return NextResponse.json({
      ok: true,
      followUp: followUp.followUp,
      reasoning: followUp.reasoning,
      stage,
      consecutiveOutbound: countTrailingOutbound(fullHistory),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function countTrailingOutbound(history: Array<{ direction: "in" | "out" }>): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].direction === "out") n++;
    else break;
  }
  return n;
}

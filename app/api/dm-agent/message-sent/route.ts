import { NextResponse } from "next/server";
import { getArtistById, listConversation, logConversation } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Logs a message that was just sent in TikTok. The dashboard manages the
// "more chunks coming" queue client-side based on what draftReply returned —
// this endpoint is a pure logger.
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

    if (!artist.first_dm_sent_at) {
      return NextResponse.json(
        { error: "first DM not yet marked sent — use Mark sent for the first message" },
        { status: 400 },
      );
    }

    // Dedupe: if the last logged outbound is the same body, don't insert again.
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

    return NextResponse.json({ ok: true, alreadyLogged });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

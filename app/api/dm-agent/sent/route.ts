import { NextResponse } from "next/server";
import { updateMondayStatus } from "@/lib/monday";
import {
  getArtistById,
  markFirstDmSent,
  STATUS_LABELS,
  updateArtistFunnelStage,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      artistId: string;
      mo3ntitId: string;
      promptId: string;
      body: string;
    };
    if (!body.artistId || !body.mo3ntitId || !body.body || !body.promptId) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    await markFirstDmSent({
      artistId: body.artistId,
      mo3ntitId: body.mo3ntitId,
      promptId: body.promptId,
      body: body.body,
    });
    // First DM done — funnel advances from hook → rapport
    await updateArtistFunnelStage(body.artistId, "rapport");

    let mondaySynced = false;
    let mondayError: string | null = null;
    const artist = await getArtistById(body.artistId);
    if (artist?.monday_id) {
      try {
        await updateMondayStatus(artist.monday_id, STATUS_LABELS.sent);
        mondaySynced = true;
      } catch (e) {
        mondayError = (e as Error).message;
      }
    }

    return NextResponse.json({ ok: true, mondaySynced, mondayError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

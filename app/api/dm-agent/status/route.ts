import { NextResponse } from "next/server";
import { updateMondayStatus } from "@/lib/monday";
import {
  ARTIST_STATUSES,
  STATUS_LABELS,
  updateArtistStatus,
  type ArtistStatus,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { artistId: string; status: ArtistStatus };
    if (!body.artistId || !body.status) {
      return NextResponse.json({ error: "artistId and status required" }, { status: 400 });
    }
    if (!ARTIST_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `invalid status; must be one of ${ARTIST_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const updated = await updateArtistStatus(body.artistId, body.status);

    let mondaySynced = false;
    let mondayError: string | null = null;
    if (updated.mondayId) {
      try {
        await updateMondayStatus(updated.mondayId, STATUS_LABELS[body.status]);
        mondaySynced = true;
      } catch (e) {
        mondayError = (e as Error).message;
      }
    }

    return NextResponse.json({
      ok: true,
      status: updated.status,
      mondayId: updated.mondayId,
      mondaySynced,
      mondayError,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

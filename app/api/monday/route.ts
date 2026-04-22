import { NextResponse } from "next/server";
import { listRecentArtists } from "@/lib/monday";

export const runtime = "nodejs";

export async function GET() {
  try {
    const artists = await listRecentArtists(50);
    return NextResponse.json({ artists });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { generateFirstDm } from "@/lib/dm-agent";
import {
  getArtistById,
  getMo3ntitById,
  getPromptById,
  incrementPromptUses,
  listActivePrompts,
  pickActivePrompt,
  updateArtistDmDraft,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      artistId: string;
      mo3ntitId: string;
      promptId?: string | null;
    };

    const artist = await getArtistById(body.artistId);
    if (!artist) return NextResponse.json({ error: "artist not found" }, { status: 404 });

    const mo3ntit = await getMo3ntitById(body.mo3ntitId);
    if (!mo3ntit) return NextResponse.json({ error: "mo3ntit not found" }, { status: 404 });

    const prompt = body.promptId
      ? await getPromptById(body.promptId)
      : await pickActivePrompt();
    if (!prompt) return NextResponse.json({ error: "no prompt available" }, { status: 400 });

    const dm = await generateFirstDm({ artist, mo3ntit, prompt });
    await updateArtistDmDraft({
      artistId: artist.id,
      selectedMo3ntitId: mo3ntit.id,
      currentDm: dm,
      promptId: prompt.id,
    });
    await incrementPromptUses(prompt.id);

    const activePrompts = await listActivePrompts();
    return NextResponse.json({ dm, prompt, activePrompts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

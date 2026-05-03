import { NextResponse } from "next/server";
import { generateFirstDm, selectMo3ntitWithRotation } from "@/lib/dm-agent";
import {
  getArtistById,
  getMo3ntitAssignmentCounts,
  getMo3ntitById,
  getNextArtistForDm,
  getPromptById,
  incrementPromptUses,
  listActivePrompts,
  listAllMo3ntitin,
  listConversation,
  pickActivePrompt,
  updateArtistDmDraft,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const explicitArtistId = url.searchParams.get("artistId");

    const artist = explicitArtistId
      ? await getArtistById(explicitArtistId)
      : await getNextArtistForDm();
    if (!artist) {
      return NextResponse.json({ error: "no artist available" }, { status: 404 });
    }

    // Fast path: already pre-assigned. Return the stored DM without regenerating.
    if (artist.current_dm && artist.selected_mo3ntit_id && artist.last_prompt_id) {
      const [mo3ntit, prompt, history, activePrompts] = await Promise.all([
        getMo3ntitById(artist.selected_mo3ntit_id),
        getPromptById(artist.last_prompt_id),
        listConversation(artist.id),
        listActivePrompts(),
      ]);
      if (mo3ntit && prompt) {
        return NextResponse.json({
          artist,
          mo3ntit,
          dm: artist.current_dm,
          prompt,
          activePrompts,
          matchReason: "pre-assigned",
          history,
          alreadySent: !!artist.first_dm_sent_at,
        });
      }
      // fall through if FK targets disappeared
    }

    const [mo3ntitin, counts] = await Promise.all([
      listAllMo3ntitin(),
      getMo3ntitAssignmentCounts(),
    ]);
    if (mo3ntitin.length === 0) {
      return NextResponse.json({ error: "no mo3ntitin in roster" }, { status: 400 });
    }

    const prompt = await pickActivePrompt();
    if (!prompt) {
      return NextResponse.json({ error: "no active prompts" }, { status: 400 });
    }

    const sel = await selectMo3ntitWithRotation({ artist, mo3ntitin, counts });
    const mo3ntit = mo3ntitin.find((m) => m.id === sel.mo3ntitId)!;

    const dm = await generateFirstDm({ artist, mo3ntit, prompt });
    await updateArtistDmDraft({
      artistId: artist.id,
      selectedMo3ntitId: mo3ntit.id,
      currentDm: dm,
      promptId: prompt.id,
    });
    await incrementPromptUses(prompt.id);

    const history = await listConversation(artist.id);
    const activePrompts = await listActivePrompts();

    return NextResponse.json({
      artist: { ...artist, current_dm: dm, selected_mo3ntit_id: mo3ntit.id, last_prompt_id: prompt.id },
      mo3ntit,
      dm,
      prompt,
      activePrompts,
      matchReason: sel.reason,
      history,
      alreadySent: !!artist.first_dm_sent_at,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

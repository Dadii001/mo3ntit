import { NextResponse } from "next/server";
import { updateMondayStatus } from "@/lib/monday";
import {
  analyzeConversationScreenshot,
  createArtistFromHandle,
  draftReply,
  FUNNEL_STAGES,
  type FunnelStage,
} from "@/lib/dm-agent";
import {
  findArtistByHandle,
  getMo3ntitById,
  listConversation,
  logConversation,
  STATUS_LABELS,
  updateArtistFunnelStage,
  updateArtistStatus,
  type ArtistRow,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { imageBase64, mo3ntitId } = (await req.json()) as {
      imageBase64: string;
      mo3ntitId?: string | null;
    };
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
    }

    const analysis = await analyzeConversationScreenshot(imageBase64);

    let artist: ArtistRow | null = null;
    let createdArtist = false;
    if (analysis.artistHandle) {
      artist = await findArtistByHandle(analysis.artistHandle);
      if (!artist) {
        try {
          artist = await createArtistFromHandle(analysis.artistHandle);
          createdArtist = true;
        } catch (e) {
          return NextResponse.json({
            analysis,
            artist: null,
            draft: null,
            warning: `Could not auto-add @${analysis.artistHandle}: ${(e as Error).message}`,
          });
        }
      }
    }

    if (!artist) {
      return NextResponse.json({
        analysis,
        artist: null,
        draft: null,
        warning: "Could not read the artist's handle from the screenshot",
      });
    }

    // Reconcile screenshot with DB log: insert any new messages we haven't logged yet.
    const existing = await listConversation(artist.id);
    const existingBodies = new Set(existing.map((m) => `${m.direction}:${m.body.trim()}`));
    const screenshotMessages: Array<{ direction: "in" | "out"; body: string }> = [
      ...analysis.outbound.map((b) => ({ direction: "out" as const, body: b })),
      ...analysis.inbound.map((b) => ({ direction: "in" as const, body: b })),
    ];
    for (const m of screenshotMessages) {
      const key = `${m.direction}:${m.body.trim()}`;
      if (!existingBodies.has(key) && m.body.trim()) {
        await logConversation({
          artistId: artist.id,
          mo3ntitId: mo3ntitId ?? artist.selected_mo3ntit_id ?? null,
          direction: m.direction,
          body: m.body,
          source: "screenshot",
        });
        existingBodies.add(key);
      }
    }

    const latestInbound = analysis.inbound.at(-1);
    if (!latestInbound) {
      const fullHistory = await listConversation(artist.id);
      return NextResponse.json({
        analysis,
        artist,
        draft: null,
        history: fullHistory,
        note: "No inbound message visible — nothing to reply to",
      });
    }

    const mo3ntitIdToUse = mo3ntitId ?? artist.selected_mo3ntit_id;
    const mo3ntit = mo3ntitIdToUse ? await getMo3ntitById(mo3ntitIdToUse) : null;

    const fullHistory = await listConversation(artist.id);
    const currentStage = (FUNNEL_STAGES as readonly string[]).includes(
      artist.funnel_stage ?? "",
    )
      ? (artist.funnel_stage as FunnelStage)
      : ("rapport" as FunnelStage);
    const draftResult = await draftReply({
      artist,
      mo3ntit,
      stage: currentStage,
      history: fullHistory.map((m) => ({ direction: m.direction, body: m.body })),
      latestInbound,
    });

    let stageAdvanced = false;
    let statusBumped = false;
    if (draftResult.stageAfter !== currentStage) {
      await updateArtistFunnelStage(artist.id, draftResult.stageAfter);
      stageAdvanced = true;
      // Reaching closing means the artist is showing real interest — flag for offer.
      if (draftResult.stageAfter === "closing" && artist.status !== "needs_offer") {
        try {
          await updateArtistStatus(artist.id, "needs_offer");
          if (artist.monday_id) {
            await updateMondayStatus(artist.monday_id, STATUS_LABELS.needs_offer);
          }
          statusBumped = true;
        } catch {
          // best-effort — don't break the draft response
        }
      }
    }

    return NextResponse.json({
      analysis,
      artist: {
        ...artist,
        funnel_stage: draftResult.stageAfter,
        status: statusBumped ? "needs_offer" : artist.status,
      },
      mo3ntit,
      draft: draftResult.reply,
      stageBefore: currentStage,
      stageAfter: draftResult.stageAfter,
      stageRationale: draftResult.rationale,
      stageAdvanced,
      statusBumped,
      history: fullHistory,
      createdArtist,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

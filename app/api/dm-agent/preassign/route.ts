import {
  generateFirstDm,
  selectMo3ntitWithRotation,
} from "@/lib/dm-agent";
import {
  getMo3ntitAssignmentCounts,
  incrementPromptUses,
  listAllMo3ntitin,
  listPendingArtists,
  pickActivePrompt,
  updateArtistDmDraft,
  type ArtistRow,
  type DmPromptRow,
  type Mo3ntitRow,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const GEN_CONCURRENCY = 5;

type Plan = {
  artist: ArtistRow;
  mo3ntit: Mo3ntitRow;
  prompt: DmPromptRow;
  matchReason: string;
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? "100")));
  const onlyUnassigned = url.searchParams.get("onlyUnassigned") !== "false";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));

      try {
        const [artists, mo3ntitin, counts] = await Promise.all([
          listPendingArtists(limit, { onlyUnassigned }),
          listAllMo3ntitin(),
          getMo3ntitAssignmentCounts(),
        ]);

        if (mo3ntitin.length === 0) {
          send({ type: "error", message: "no mo3ntitin in roster" });
          controller.close();
          return;
        }
        if (artists.length === 0) {
          send({ type: "summary", ok: 0, failed: 0, total: 0, message: "nothing pending" });
          controller.close();
          return;
        }

        send({ type: "start", total: artists.length });
        send({ type: "phase", phase: "planning", processed: 0, total: artists.length });

        // PHASE 1: sequential rotation planning. Each artist consults the
        // running counts so every mo3ntit gets one before any gets two.
        const plan: Plan[] = [];
        const planFailures: Array<{ handle: string; error: string }> = [];
        for (let i = 0; i < artists.length; i++) {
          const artist = artists[i];
          try {
            const prompt = await pickActivePrompt();
            if (!prompt) throw new Error("no active prompts");
            const sel = await selectMo3ntitWithRotation({ artist, mo3ntitin, counts });
            const mo3ntit = mo3ntitin.find((m) => m.id === sel.mo3ntitId);
            if (!mo3ntit) throw new Error("matcher returned unknown id");
            counts.set(mo3ntit.id, (counts.get(mo3ntit.id) ?? 0) + 1);
            plan.push({ artist, mo3ntit, prompt, matchReason: sel.reason });
            send({
              type: "planned",
              handle: artist.account,
              mo3ntit: mo3ntit.handle,
              promptName: prompt.name,
            });
          } catch (e) {
            planFailures.push({ handle: artist.account, error: (e as Error).message });
            send({ type: "fail", handle: artist.account, error: (e as Error).message });
          }
          send({ type: "phase", phase: "planning", processed: i + 1, total: artists.length });
        }

        // PHASE 2: parallel generation + save.
        send({ type: "phase", phase: "generating", processed: 0, total: plan.length });

        let ok = 0;
        let failed = planFailures.length;
        let processed = 0;
        const queue = [...plan];

        async function worker() {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) return;
            try {
              const dm = await generateFirstDm({
                artist: item.artist,
                mo3ntit: item.mo3ntit,
                prompt: item.prompt,
              });
              await updateArtistDmDraft({
                artistId: item.artist.id,
                selectedMo3ntitId: item.mo3ntit.id,
                currentDm: dm,
                promptId: item.prompt.id,
              });
              await incrementPromptUses(item.prompt.id);
              ok++;
              send({
                type: "done",
                handle: item.artist.account,
                nickname: item.artist.nickname,
                mo3ntit: item.mo3ntit.handle,
                promptName: item.prompt.name,
                dmPreview: dm.length > 90 ? `${dm.slice(0, 90)}...` : dm,
              });
            } catch (e) {
              failed++;
              send({
                type: "fail",
                handle: item.artist.account,
                error: (e as Error).message,
              });
            }
            processed++;
            send({ type: "phase", phase: "generating", processed, total: plan.length });
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(GEN_CONCURRENCY, plan.length) }, () => worker()),
        );

        send({ type: "summary", ok, failed, total: artists.length });
        controller.close();
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}

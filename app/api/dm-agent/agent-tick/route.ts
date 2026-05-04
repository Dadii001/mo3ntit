import { runAgentTick } from "@/lib/agent-loop";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    artistId: string;
    trigger: "start" | "inbox" | "conversation" | "message_sent";
    imageBase64?: string;
    extraNote?: string;
  };

  if (!body.artistId || !body.trigger) {
    return new Response(JSON.stringify({ error: "artistId and trigger required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));

      send({ type: "start", trigger: body.trigger });

      try {
        const result = await runAgentTick({
          artistId: body.artistId,
          trigger: body.trigger,
          imageBase64: body.imageBase64,
          extraNote: body.extraNote,
          emit: (a) => send({ type: "action", action: a }),
        });
        send({
          type: "done",
          stopReason: result.stopReason,
          finalStatus: result.finalStatus,
          finalStage: result.finalStage,
          agentText: result.agentText,
        });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache, no-transform" },
  });
}

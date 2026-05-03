import { analyzeCreator } from "@/lib/mo3ntitin";
import { saveMo3ntitToSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 800;

const DEFAULT_HANDLES = [
  "alex.gasx",
  ".ryanfloress",
  "nancy.rar",
  "salwa.rosa",
  "sara.morgaaan",
  "aubert.junior",
  "tonyreborn",
  "leoluveu",
  "xferrucio",
  "ellenighty",
  "iamzaniollo",
  "lucassinthehouse",
  "iza_haircare",
  "bouras_stof",
  "rima.kremen",
  "larrys_life",
  "miro.boy.cat",
  "mayatheonly",
  "lauramkp_",
  "tanyaeisha",
  "ginny.celia",
  "liltaliabright",
  "justin.joash",
  "alexis_samani",
  "itscarty",
  "stephaniezelij",
  "ohgoldiezoe",
  "aria.cisneros",
  "rebecagotback",
];

export async function POST(req: Request) {
  let handles: string[] = DEFAULT_HANDLES;
  try {
    const body = (await req.json()) as { handles?: string[] };
    if (Array.isArray(body?.handles) && body.handles.length > 0) handles = body.handles;
  } catch {
    // empty body — use defaults
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      send({ type: "start", total: handles.length });
      let ok = 0;
      let failed = 0;

      for (let i = 0; i < handles.length; i++) {
        const handle = handles[i];
        send({ type: "progress", index: i, total: handles.length, handle, status: "analyzing" });
        try {
          const creator = await analyzeCreator(handle);
          await saveMo3ntitToSupabase(creator);
          ok++;
          send({
            type: "done",
            index: i,
            handle,
            gender: creator.gender,
            description: creator.description,
            vibe: creator.vibe,
            styleTags: creator.styleTags,
            videosAnalyzed: creator.videosAnalyzed,
          });
        } catch (e) {
          failed++;
          send({ type: "fail", index: i, handle, error: (e as Error).message });
        }
      }

      send({ type: "summary", ok, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

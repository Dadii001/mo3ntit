import { NextResponse } from "next/server";
import {
  listAllMo3ntitin,
  updateMo3ntitAvatar,
  uploadAvatar,
} from "@/lib/supabase";
import { getUserInfo } from "@/lib/tiktok";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function downloadAvatar(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Referer: "https://www.tiktok.com/", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "image/jpeg",
  };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const onlyHandle = url.searchParams.get("handle");

  const all = await listAllMo3ntitin();
  const targets = onlyHandle
    ? all.filter((m) => m.handle.toLowerCase() === onlyHandle.toLowerCase())
    : all;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));

      send({ type: "start", total: targets.length });
      let ok = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i++) {
        const m = targets[i];
        try {
          send({ type: "progress", index: i, handle: m.handle, status: "fetching" });
          const profile = await getUserInfo(m.handle);
          const fresh = profile.avatarLarger;
          if (!fresh) throw new Error("no avatar URL from TikTok");

          const { buffer, contentType } = await downloadAvatar(fresh);
          const ext = contentType.includes("png") ? "png" : "jpg";
          const key = `mo3ntit/${m.handle.toLowerCase()}.${ext}`;
          const publicUrl = await uploadAvatar({ key, buffer, contentType });
          // append a cache-buster so existing CDN-cached <img> tags refresh
          const finalUrl = `${publicUrl}?v=${Date.now()}`;
          await updateMo3ntitAvatar(m.id, finalUrl);
          ok++;
          send({ type: "done", index: i, handle: m.handle, url: finalUrl });
        } catch (e) {
          failed++;
          send({ type: "fail", index: i, handle: m.handle, error: (e as Error).message });
        }
      }

      send({ type: "summary", ok, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}

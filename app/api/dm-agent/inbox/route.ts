import { NextResponse } from "next/server";
import { analyzeInboxScreenshot } from "@/lib/dm-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { imageBase64 } = (await req.json()) as { imageBase64: string };
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
    }
    const result = await analyzeInboxScreenshot(imageBase64);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

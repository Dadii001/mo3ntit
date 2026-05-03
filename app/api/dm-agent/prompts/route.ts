import { NextResponse } from "next/server";
import { createPrompt, listPrompts } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ prompts: await listPrompts() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name: string;
      description?: string | null;
      template: string;
      is_active?: boolean;
    };
    if (!body.name || !body.template) {
      return NextResponse.json({ error: "name and template required" }, { status: 400 });
    }
    const created = await createPrompt({
      name: body.name,
      description: body.description ?? null,
      template: body.template,
      is_active: body.is_active ?? true,
    });
    return NextResponse.json(created);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

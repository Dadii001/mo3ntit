import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/agents/registry";

export function GET() {
  return NextResponse.json({ agents: AGENTS });
}

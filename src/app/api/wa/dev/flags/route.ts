import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    const GPT_ONLY = String(process.env.WA_GPT_ONLY || "false").toLowerCase() === "true";
    const AI = String(process.env.WA_AI_ENABLED || "true").toLowerCase() === "true";
    const TABS = String(process.env.WA_TABS_ENABLED || "false").toLowerCase() === "true";
    const INTERACTIVE = String(process.env.WA_INTERACTIVE_ENABLED || "false").toLowerCase() === "true";
    return NextResponse.json({ ok: true, flags: { DRY, GPT_ONLY, AI, TABS, INTERACTIVE } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "flags failed" }, { status: 500 });
  }
}

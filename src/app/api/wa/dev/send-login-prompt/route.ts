import { NextResponse } from "next/server";
import { promptWebLogin } from "@/server/wa_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Dev-only endpoint to trigger a login prompt via dispatcher
// POST { phoneE164: "+2547...", reason?: string }
export async function POST(req: Request) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (!DRY) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    const { phoneE164, reason } = (await req.json()) as { phoneE164?: string; reason?: string };
    if (!phoneE164) return NextResponse.json({ ok: false, error: "phoneE164 required" }, { status: 400 });
    await promptWebLogin(phoneE164, reason);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send-login-prompt failed" }, { status: 500 });
  }
}

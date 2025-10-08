import { NextResponse } from "next/server";
import { promptWebLogin } from "@/server/wa_gate";
import { prisma } from "@/lib/prisma";
import { createLoginLink } from "@/server/wa_links";
import { composeWaMessage } from "@/lib/ai_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Dev-only endpoint to trigger a login prompt via dispatcher
// POST { phoneE164: "+2547...", reason?: string }
export async function POST(req: Request) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    const { phoneE164, reason, key } = (await req.json()) as { phoneE164?: string; reason?: string; key?: string };
    const adminKey = process.env.ADMIN_DIAG_KEY || "";
    // In production, allow only when ADMIN_DIAG_KEY matches; otherwise require DRY
    if (!DRY && (!adminKey || key !== adminKey)) {
      return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    }
    if (!phoneE164) return NextResponse.json({ ok: false, error: "phoneE164 required" }, { status: 400 });
    await promptWebLogin(phoneE164, reason);
    // Return the latest outbound log for this phone to aid tests
    try {
      const phoneDigits = String(phoneE164).replace(/[^0-9+]/g, "").replace(/^\+/, "");
      const e164 = "+" + phoneDigits;
      // Best-effort preview of composed text
      let previewText: string | undefined;
      try {
        const { url } = await createLoginLink(phoneE164);
        const composed = await composeWaMessage({ kind: "login_prompt", reason }, { deepLink: url });
        previewText = composed.text;
      } catch {}
      const row = await (prisma as any).waMessageLog.findFirst({
        where: {
          direction: "out",
          OR: [
            { payload: { path: ["meta", "phoneE164"], equals: e164 } as any },
            { payload: { path: ["request", "to"], equals: phoneDigits } as any },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, status: true, payload: true },
      });
      return NextResponse.json({ ok: true, row, previewText });
    } catch {
      return NextResponse.json({ ok: true });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send-login-prompt failed" }, { status: 500 });
  }
}

// Production-safe GET variant gated by ADMIN_DIAG_KEY
// /api/wa/dev/send-login-prompt?phone=+2547...&reason=...&key=ADMIN_DIAG_KEY
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone") || searchParams.get("phoneE164") || "";
    const reason = searchParams.get("reason") || undefined;
    const key = searchParams.get("key") || "";
    const adminKey = process.env.ADMIN_DIAG_KEY || "";
    if (!adminKey || key !== adminKey) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const digits = phone.replace(/[^0-9+]/g, "");
    const e164 = digits.startsWith("+") ? digits : "+" + digits;
    if (!e164 || e164.length < 10) return NextResponse.json({ ok: false, error: "phone required" }, { status: 400 });
    await promptWebLogin(e164, reason);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send-login-prompt GET failed" }, { status: 500 });
  }
}

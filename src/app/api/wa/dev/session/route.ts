import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/wa/dev/session?phoneE164=+2547... or ?phone=2547... [&key=ADMIN_DIAG_KEY]
// Dev helper: returns the current waSession row for the phone.
// In production, require ADMIN_DIAG_KEY. In dev/dry-run, allow without key.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("phoneE164") || searchParams.get("phone") || "";
    const key = searchParams.get("key") || "";
    const adminKey = process.env.ADMIN_DIAG_KEY || "";
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";

    if (!DRY && (!adminKey || key !== adminKey)) {
      return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    }

    const digits = String(raw).replace(/[^0-9+]/g, "");
    const e164 = digits.startsWith("+") ? digits : "+" + digits;
    if (!e164 || e164.length < 10) return NextResponse.json({ ok: false, error: "phone required" }, { status: 400 });

    const session = await (prisma as any).waSession.findUnique({ where: { phoneE164: e164 } }).catch(() => null);
    return NextResponse.json({ ok: true, session });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "session lookup failed" }, { status: 500 });
  }
}

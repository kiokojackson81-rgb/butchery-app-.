import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (!DRY) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    const { searchParams } = new URL(req.url);
    const phoneE164 = searchParams.get("phoneE164") || "";
    if (!phoneE164) return NextResponse.json({ ok: false, error: "phoneE164 required" }, { status: 400 });
    const p = phoneE164.startsWith("+") ? phoneE164 : "+" + String(phoneE164).replace(/[^0-9+]/g, "");
    const sess = await (prisma as any).waSession.findUnique({ where: { phoneE164: p } });
    return NextResponse.json({ ok: true, sess });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "session fetch failed" }, { status: 500 });
  }
}

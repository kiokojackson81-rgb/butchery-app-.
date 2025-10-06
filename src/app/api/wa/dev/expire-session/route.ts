import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Dev-only endpoint: POST { phoneE164, minutesAgo }
export async function POST(req: Request) {
  try {
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (!DRY) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    const { phoneE164, minutesAgo } = await req.json();
    if (!phoneE164) return NextResponse.json({ ok: false, error: "phoneE164 required" }, { status: 400 });
    const mins = Number(minutesAgo || 120);
    const past = new Date(Date.now() - mins * 60_000);
    const p = phoneE164.startsWith("+") ? phoneE164 : "+" + String(phoneE164).replace(/[^0-9+]/g, "");
    await (prisma as any).waSession.update({ where: { phoneE164: p }, data: { updatedAt: past } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "expire failed" }, { status: 500 });
  }
}

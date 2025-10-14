import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || null;
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "DB_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    // Simple connectivity probe
    await (prisma as any).$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = process.env.NODE_ENV !== "production" ? (e?.message || String(e)) : "DB_UNAVAILABLE";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}

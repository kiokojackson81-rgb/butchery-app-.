import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { loadPrisma, upsertPricebookRow } from "../_shared";

export async function GET() {
  try {
    const isProd = process.env.NODE_ENV === "production" && process.env.VERCEL === "1";
    const allow = !isProd || String(process.env.WA_DRY_RUN || "").toLowerCase() === "true";
    if (!allow) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const prisma = await loadPrisma();
    // Optional: allow overrides via query params (?outletName=...&productKey=...)
    // but default to Bright/beef for convenience
    // Note: GET should be idempotent; we use upsert here for test-only convenience.
    const outletName = "Bright";
    const productKey = "beef";
    const sellPrice = 1000;
    const active = true;
    await upsertPricebookRow(prisma as any, { outletName, productKey, sellPrice, active });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

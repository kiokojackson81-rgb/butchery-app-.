import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    // Guard: require STATUS_PUBLIC_KEY or restrict to DRY/non-prod
    const url = new URL(req.url);
    const provided = req.headers.get("x-status-key") || url.searchParams.get("key") || "";
    const required = process.env.STATUS_PUBLIC_KEY || "";
    const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
    if (!DRY && (!required || provided !== required)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    await (prisma as any).$executeRawUnsafe(
      'ALTER TABLE "public"."WaMessageLog" ADD COLUMN IF NOT EXISTS "type" TEXT'
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "failed" }, { status: 500 });
  }
}

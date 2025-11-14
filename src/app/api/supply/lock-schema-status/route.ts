import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

// Cached detection result (process lifetime)
let __hasLockCols: boolean | null = null;

async function detectLockCols(): Promise<boolean> {
  if (__hasLockCols != null) return __hasLockCols;
  try {
    // Fast probe: attempt selecting lockedAt/lockedBy; treat missing-column error as false.
    await (prisma as any).supplyOpeningRow.findMany({ select: { id: true, lockedAt: true, lockedBy: true }, take: 1 });
    __hasLockCols = true;
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('lockedat') && msg.includes('does not exist')) __hasLockCols = false;
    else if (msg.includes('lockedby') && msg.includes('does not exist')) __hasLockCols = false;
    else {
      // As a fallback, verify via information_schema (covers the case where table empty but columns exist)
      try {
        const rows: any[] = await (prisma as any).$queryRawUnsafe(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='SupplyOpeningRow' AND column_name IN ('lockedAt','lockedBy')`
        );
        const names = new Set(rows.map(r => r.column_name));
        __hasLockCols = names.has('lockedAt') && names.has('lockedBy');
      } catch {
        __hasLockCols = true; // assume present to avoid noisy false negatives
      }
    }
  }
  return __hasLockCols;
}

export async function GET() {
  try {
    const hasLockCols = await detectLockCols();
    return NextResponse.json({ ok: true, hasLockCols, legacyMode: !hasLockCols });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'failed') }, { status: 500 });
  }
}

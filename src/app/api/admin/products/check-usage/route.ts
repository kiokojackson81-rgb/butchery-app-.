import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = String(url.searchParams.get("key") || "").trim();
    if (!key) return NextResponse.json({ ok: false, error: "key required" }, { status: 400 });

    // Check common tables that reference products by key
    const [openingCount, closingCount, transferCount, requestCount] = await Promise.all([
      (prisma as any).supplyOpeningRow.count({ where: { itemKey: key } }).catch(() => 0),
      (prisma as any).attendantClosing.count({ where: { itemKey: key } }).catch(() => 0),
      (prisma as any).supplyTransfer.count({ where: { itemKey: key } }).catch(() => 0),
      (prisma as any).supplyRequest.count({ where: { productKey: key } }).catch(() => 0),
    ]);

    const total = Number(openingCount || 0) + Number(closingCount || 0) + Number(transferCount || 0) + Number(requestCount || 0);
    const details = [] as Array<{ table: string; count: number }>;
    if (openingCount) details.push({ table: 'supplyOpeningRow', count: openingCount });
    if (closingCount) details.push({ table: 'attendantClosing', count: closingCount });
    if (transferCount) details.push({ table: 'supplyTransfer', count: transferCount });
    if (requestCount) details.push({ table: 'supplyRequest', count: requestCount });

    return NextResponse.json({ ok: true, used: total > 0, total, details });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

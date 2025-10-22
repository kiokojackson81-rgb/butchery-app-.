import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(req: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    const productKey = String(key || "").trim();
    if (!productKey) return NextResponse.json({ ok: false, error: 'key required' }, { status: 400 });

    const url = new URL(req.url);
    const soft = url.searchParams.get('soft') === 'true';

    // Inspect references
    const [openingCount, closingCount, transferCount, requestCount] = await Promise.all([
      (prisma as any).supplyOpeningRow.count({ where: { itemKey: productKey } }).catch(() => 0),
      (prisma as any).attendantClosing.count({ where: { itemKey: productKey } }).catch(() => 0),
      (prisma as any).supplyTransfer.count({ where: { itemKey: productKey } }).catch(() => 0),
      (prisma as any).supplyRequest.count({ where: { productKey: productKey } }).catch(() => 0),
    ]);

    const total = Number(openingCount || 0) + Number(closingCount || 0) + Number(transferCount || 0) + Number(requestCount || 0);

    if (total > 0) {
      if (soft) {
        // Soft deactivate
        const saved = await (prisma as any).product.update({ where: { key: productKey }, data: { active: false } }).catch(() => null);
        if (!saved) return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 });
        return NextResponse.json({ ok: true, deactivated: true });
      }

      // Return 409 with details about referencing tables
      const details = [] as Array<{ table: string; count: number }>;
      if (openingCount) details.push({ table: 'supplyOpeningRow', count: openingCount });
      if (closingCount) details.push({ table: 'attendantClosing', count: closingCount });
      if (transferCount) details.push({ table: 'supplyTransfer', count: transferCount });
      if (requestCount) details.push({ table: 'supplyRequest', count: requestCount });
      return NextResponse.json({ ok: false, error: 'referenced', total, details }, { status: 409 });
    }

    // Safe to delete
    const deleted = await (prisma as any).product.delete({ where: { key: productKey } }).catch(() => null);
    if (!deleted) return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

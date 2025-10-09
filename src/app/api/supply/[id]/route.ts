// src/app/api/supply/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatSupplyForRole } from '@/lib/format/supply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const role = req.headers.get('x-role') || 'attendant';
  const id = params.id;
  const row = await (prisma as any).$queryRawUnsafe(`
    SELECT s.id, s.status, s.eta, s.ref, o.name as outlet_name, sup.name as supplier_name,
      COUNT(i.id) as line_count, COALESCE(SUM(i.qty),0) as total_qty, COALESCE(SUM(i.qty*i.unit_price),0) as total_cost
    FROM "Supply" s
    JOIN "Outlet" o ON o.id = s.outlet_id
    JOIN "Supplier" sup ON sup.id = s.supplier_id
    LEFT JOIN "SupplyItem" i ON i.supply_id = s.id
    WHERE s.id = $1
    GROUP BY s.id, o.name, sup.name
  `, id);
  const r = Array.isArray(row) ? row[0] : null;
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const items = await (prisma as any).supplyItem.findMany({ where: { supply_id: id }, select: { id: true, qty: true, unit: true, unit_price: true, product_id: true } }).catch(()=>[]);
  const productMap: Record<string,string> = {};
  if (items.length) {
    const ids = items.map((i:any) => i.product_id).filter(Boolean);
    const prods = await (prisma as any).product.findMany({ where: { key: { in: ids } }, select: { key: true, name: true } }).catch(() => []);
    for (const p of prods) productMap[p.key] = p.name;
  }
  const itemViews = (items || []).map((it: any) => ({ name: productMap[it.product_id] || String(it.product_id), qty: Number(it.qty || 0), unit: it.unit || '', unitPrice: it.unit_price || undefined }));
  const view = { id: r.id, outletName: r.outlet_name, supplierName: r.supplier_name, items: itemViews, totalQty: Number(r.total_qty || 0), totalCost: Number(r.total_cost || 0), eta: r.eta || null, ref: r.ref || null, status: r.status || 'unknown' };
  const formatted = formatSupplyForRole(view as any, role as any);
  return NextResponse.json({ ok: true, supply: formatted });
}

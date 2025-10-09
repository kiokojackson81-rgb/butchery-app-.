// src/app/api/supplies/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const outlet = url.searchParams.get('outlet');
  const status = url.searchParams.get('status');
  if (!outlet) return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  const where: any = { outlet_id: outlet };
  if (status === 'today') {
    const today = new Date().toISOString().slice(0,10);
    where.created_at = { gte: `${today}T00:00:00Z` };
  } else if (status) {
    where.status = status;
  }
  const rows = await (prisma as any).$queryRawUnsafe(`
    SELECT s.id, sup.name as supplier_name, COUNT(i.id) as items_count, COALESCE(SUM(i.qty),0) as total_qty, s.eta, s.status
    FROM "Supply" s
    LEFT JOIN "SupplyItem" i ON i.supply_id = s.id
    LEFT JOIN "Supplier" sup ON sup.id = s.supplier_id
    WHERE s.outlet_id = $1 ${status && status !== 'today' ? `AND s.status = '${String(status)}'` : ''}
    GROUP BY s.id, sup.name, s.eta, s.status
    ORDER BY s.created_at DESC
  `, outlet);
  return NextResponse.json({ ok: true, supplies: Array.isArray(rows) ? rows : [] });
}

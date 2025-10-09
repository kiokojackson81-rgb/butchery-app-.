// src/app/api/supply.dispute/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueOpsEvent } from '@/lib/opsEvents';

const makeId = () => (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2,8));
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const body = await req.json().catch(()=>({}));
  const { supplyId, reason, lines, personRole, personId } = body || {};
  if (!supplyId || !reason) return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  const s = await (prisma as any).supply.update({ where: { id: supplyId }, data: { status: 'disputed' } }).catch(()=>null);
  if (!s) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  // create reviewItem for dispute
  await (prisma as any).reviewItem.create({ data: { id: makeId(), type: 'supply_dispute', outlet: s.outlet_id, date: new Date(), payload: { reason, lines, supplyId }, createdAt: new Date() } }).catch(()=>{});
  await enqueueOpsEvent({ id: makeId(), type: 'SUPPLY_DISPUTED', entityId: supplyId, outletId: s.outlet_id, supplierId: s.supplier_id, actorRole: personRole || null, dedupeKey: `SUPPLY_DISPUTED:${supplyId}:1` }).catch(()=>{});
  return NextResponse.json({ ok: true, supply: s });
}

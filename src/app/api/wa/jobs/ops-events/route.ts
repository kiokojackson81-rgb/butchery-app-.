// src/app/api/wa/jobs/ops-events/route.ts
import { NextResponse } from 'next/server';
import { fetchUnprocessedOpsEvents, markEventHandled } from '@/lib/opsEvents';
import { prisma } from '@/lib/prisma';
import { gptDispatch } from '@/lib/wa/gptDispatcher';
import { sendInteractiveSafe, sendTextSafe, sendTemplate } from '@/lib/wa';
import { formatSupplyForRole } from '@/lib/format/supply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// CRON/worker endpoint to process OpsEvents and notify via GPT
export async function GET() {
  const events = await fetchUnprocessedOpsEvents(100);
  const results: any[] = [];
  for (const ev of events) {
    try {
      // load supply summary
      const supplyId = ev.entityId;
      const supply = await loadSupplyView(supplyId);
      if (!supply) {
        await markEventHandled(ev.id);
        results.push({ id: ev.id, status: 'no-supply' });
        continue;
      }
      // build recipients
      const recipients = await resolveRecipients(ev.outletId, ev.supplierId);
      const eventKey = `${ev.type}:${supplyId}:1`;
      const sentCounts: Record<string, number> = { supplier: 0, attendant: 0, supervisor: 0, admin: 0 };
      for (const r of recipients) {
        try {
          // idempotency per recipient+eventKey: try to claim a message-slot by creating
          // a deterministic WaMessageLog id (eventKey:phone). If creation fails (already exists), skip.
          const role = r.role as any;
          const phoneNo = String(r.phone || "").replace(/^\+/, "");
          const msgId = `${eventKey}:${phoneNo}`;
          try {
            await (prisma as any).waMessageLog.create({ data: { id: msgId, direction: 'out', payload: { meta: { eventKey }, phone: phoneNo, role }, createdAt: new Date() } });
          } catch (e) {
            // Already claimed or insert failed -> skip to avoid duplicate send
            continue;
          }
          const view = formatSupplyForRole(supply as any, role);
          const dispatch = await gptDispatch({ kind: ev.type, role, view } as any);
          const phone = r.phone.replace(/^\+/, '');
          const e164 = `+${phone}`;
          // ensure window: send template reopen if needed (sendTemplate already used elsewhere)
          // send interactive if buttons present
          if (dispatch.buttons && dispatch.buttons.length) {
            const body = { messaging_product: 'whatsapp', to: phone, type: 'interactive', interactive: { type: 'button', body: { text: dispatch.text }, action: { buttons: dispatch.buttons.map((b: any) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) } } };
            await sendInteractiveSafe(body, 'AI_DISPATCH_INTERACTIVE');
          } else {
            await sendTextSafe(e164, dispatch.text, 'AI_DISPATCH_TEXT');
          }
          sentCounts[role] = (sentCounts[role] || 0) + 1;
          // write back result metadata into WaMessageLog for observability
          try {
            await (prisma as any).waMessageLog.update({ where: { id: msgId }, data: { payload: { meta: { eventKey }, phone: phoneNo, role, dispatched: true }, sent_at: new Date() } });
          } catch (e) {
            // best-effort: ignore update failures
          }
        } catch (err) {
          console.error('send failed for recipient', r, String(err));
        }
      }
      await markEventHandled(ev.id);
      results.push({ id: ev.id, status: 'handled', sent: sentCounts });
    } catch (err) {
      console.error('event processing failed', ev, String(err));
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function loadSupplyView(supplyId: string | null) {
  if (!supplyId) return null;
  // try to resolve supply header and items using existing tables
  const row = await (prisma as any).$queryRawUnsafe(`
    SELECT s.id, s.status, s.eta, s.ref, o.name as outlet_name, sup.name as supplier_name,
      COUNT(i.id) as line_count, COALESCE(SUM(i.qty),0) as total_qty, COALESCE(SUM(i.qty*i.unit_price),0) as total_cost
    FROM "Supply" s
    JOIN "Outlet" o ON o.id = s.outlet_id
    JOIN "Supplier" sup ON sup.id = s.supplier_id
    LEFT JOIN "SupplyItem" i ON i.supply_id = s.id
    WHERE s.id = $1
    GROUP BY s.id, o.name, sup.name
  `, supplyId);
  const r = Array.isArray(row) ? row[0] : null;
  if (!r) return null;
  const items = await (prisma as any).supplyItem.findMany({ where: { supplyId }, select: { id: true, qty: true, unit: true, unitPrice: true, productId: true } }).catch(() => []);
  const productMap: Record<string,string> = {};
  if (items.length) {
    const ids = items.map((i:any) => i.productId).filter(Boolean);
    const prods = await (prisma as any).product.findMany({ where: { key: { in: ids } }, select: { key: true, name: true } }).catch(() => []);
    for (const p of prods) productMap[p.key] = p.name;
  }
  const itemViews = (items || []).map((it: any) => ({ name: productMap[it.productId] || String(it.productId), qty: Number(it.qty || 0), unit: it.unit || '', unitPrice: it.unitPrice || undefined }));
  return {
    id: r.id,
    outletName: r.outlet_name,
    supplierName: r.supplier_name,
    items: itemViews,
    totalQty: Number(r.total_qty || 0),
    totalCost: Number(r.total_cost || 0),
    eta: r.eta || null,
    ref: r.ref || null,
    status: r.status || 'unknown'
  };
}

async function resolveRecipients(outletId: string | null, supplierId: string | null) {
  const recipients: Array<{ role: string; phone: string }> = [];
  try {
    if (supplierId) {
      const s = await (prisma as any).supplier.findUnique({ where: { id: supplierId }, select: { phoneE164: true } }).catch(() => null);
      if (s?.phoneE164) recipients.push({ role: 'supplier', phone: s.phoneE164 });
    }
    // attendants by phoneMapping
    const atts = await (prisma as any).phoneMapping.findMany({ where: { role: 'attendant', outlet: outletId }, select: { phoneE164: true } }).catch(() => []);
    for (const a of atts) if (a.phoneE164) recipients.push({ role: 'attendant', phone: a.phoneE164 });
    // supervisors/admins
    const sups = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ['supervisor','admin'] as any }, outlet: outletId }, select: { phoneE164: true, role: true } }).catch(() => []);
    for (const s of sups) if (s.phoneE164) recipients.push({ role: s.role || 'supervisor', phone: s.phoneE164 });
    // admin phones from settings
    const setting = await (prisma as any).setting.findUnique({ where: { key: 'admin_phones' } }).catch(() => null);
    const adminPhones = Array.isArray(setting?.value) ? setting.value : [];
    for (const p of adminPhones) recipients.push({ role: 'admin', phone: p });
  } catch (e) {
    console.error('resolveRecipients failed', String(e));
  }
  return recipients;
}

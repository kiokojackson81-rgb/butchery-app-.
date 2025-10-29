import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseStkCallback } from '@/lib/mpesa_callback';
import logger from '@/lib/logger';
import { notifyAttendants, notifySupplier } from '@/server/supervisor/supervisor.notifications';
import { emitDepositConfirmed } from '@/lib/real_time';

const WA_DARAJA_ENABLED = String(process.env.WA_DARAJA_ENABLED ?? 'true').toLowerCase() === 'true';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// allow tests to inject a mock prisma
let localPrisma: any = prisma;
export function setPrisma(p: any){ localPrisma = p; }

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
  const parsed = parseStkCallback(payload);
  const { resultCode, resultDesc, merchantRequestId, checkoutRequestId, amount, mpesaReceipt, phone } = parsed;
    logger.info({ action: 'stkCallback:received', merchantRequestId, checkoutRequestId, msisdn: phone, amount, resultCode, raw: payload });

    if (!WA_DARAJA_ENABLED) {
      logger.info({ action: 'stkCallback:skipped', reason: 'Daraja disabled' });
      return ok({ ok: true, skipped: true });
    }

    // Idempotent update: find by checkoutRequestId first
    let payment = null;
    if (checkoutRequestId) {
      payment = await (localPrisma as any).payment.findUnique({ where: { checkoutRequestId } });
    }
    if (!payment && merchantRequestId) {
      payment = await (localPrisma as any).payment.findFirst({ where: { merchantRequestId } });
    }

    if (!payment) {
      // Create orphan on GENERAL
      const orphan = await (localPrisma as any).payment.create({ data: {
        outletCode: 'GENERAL', amount: amount || 0, msisdn: phone || '', status: resultCode === 0 ? 'SUCCESS' : 'FAILED', merchantRequestId, checkoutRequestId, mpesaReceipt, rawPayload: payload
      }});
      logger.info({ action: 'stkCallback:orphanCreated', id: orphan.id, merchantRequestId, checkoutRequestId, amount });
      return ok({ created: 'orphan', id: orphan.id });
    }

    // Avoid duplicate processing: if already SUCCESS, return ok
    if (payment.status === 'SUCCESS') return ok({ ok: true });

    const newStatus = resultCode === 0 ? 'SUCCESS' : 'FAILED';
    // Build update without relying on a non-existent 'note' field; use description for failure reason
    const updateData: any = {
      status: newStatus,
      mpesaReceipt: mpesaReceipt || payment.mpesaReceipt,
      rawPayload: payload,
    };
    if (newStatus === 'FAILED' && resultDesc) {
      updateData.description = String(resultDesc).slice(0, 256);
    }
    const update = await (localPrisma as any).payment.update({ where: { id: payment.id }, data: updateData });

    logger.info({ action: 'stkCallback:updated', id: update.id, status: newStatus, merchantRequestId, checkoutRequestId });

    if (newStatus === 'SUCCESS') {
      // emit deposit_confirmed via real-time emitter (Pusher or notify fallback)
      try {
        const msisdnMasked = phone ? `***${String(phone).slice(-3)}` : '';
        await emitDepositConfirmed({ outletCode: update.outletCode, amount: update.amount, msisdnMasked, receipt: update.mpesaReceipt, date: String(update.updatedAt) });
        logger.info({ action: 'deposit_confirmed', outletCode: update.outletCode, amount: update.amount, msisdn: msisdnMasked, receipt: update.mpesaReceipt, date: update.updatedAt });
      } catch (e:any) { logger.error({ action: 'deposit_confirmed:error', error: String(e) }); }
    }

    return ok({ updated: update.id, status: newStatus });
  } catch (e: any) {
    logger.error({ action: 'stkCallback:error', error: String(e) });
    return fail('internal error', 500);
  }
}

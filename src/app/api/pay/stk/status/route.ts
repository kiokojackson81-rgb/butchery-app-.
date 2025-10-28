import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

function maskMsisdn(msisdn?: string | null){
  if (!msisdn) return null;
  const s = String(msisdn);
  if (s.length <= 3) return '***';
  return `***${s.slice(-3)}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const checkout = url.searchParams.get('checkout') || url.searchParams.get('checkoutRequestId') || '';
    const merchant = url.searchParams.get('merchant') || url.searchParams.get('merchantRequestId') || '';

    if (!checkout && !merchant) return fail('provide checkout or merchant');

    let payment: any = null;
    if (checkout) {
      payment = await (prisma as any).payment.findUnique({ where: { checkoutRequestId: checkout } });
    }
    if (!payment && merchant) {
      payment = await (prisma as any).payment.findFirst({ where: { merchantRequestId: merchant } });
    }

    if (!payment) return ok({ found: false });

    const out: any = {
      found: true,
      id: payment.id,
      outletCode: payment.outletCode,
      amount: Number(payment.amount || 0),
      status: payment.status,
      msisdn: maskMsisdn(payment.msisdn),
      mpesaReceipt: payment.mpesaReceipt || null,
      merchantRequestId: payment.merchantRequestId || null,
      checkoutRequestId: payment.checkoutRequestId || null,
      businessShortCode: payment.businessShortCode || null,
      storeNumber: payment.storeNumber || null,
      headOfficeNumber: payment.headOfficeNumber || null,
      note: payment.note || null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      hasRawPayload: !!payment.rawPayload,
    };

    return ok(out);
  } catch (e: any) {
    logger.error({ action: 'stkStatus:error', error: String(e) });
    return fail('internal error', 500);
  }
}

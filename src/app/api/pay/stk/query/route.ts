import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { DarajaQuery } from '@/lib/daraja_client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const checkout = url.searchParams.get('checkout') || url.searchParams.get('checkoutRequestId') || '';
    if (!checkout) return fail('checkout required');

    // Look up the payment to learn the businessShortCode used
    const payment = await (prisma as any).payment.findUnique({ where: { checkoutRequestId: checkout } });
    if (!payment) return fail('payment_not_found', 404);

    const bsc = String(payment.businessShortCode || payment.headOfficeNumber || '');
    if (!bsc) return fail('missing_business_shortcode_on_payment', 500);

    // Prefer per-shortcode passkey if present
    const perKeyEnv = `DARAJA_PASSKEY_${bsc}`;
    const perKey = (process.env as any)[perKeyEnv];

    const { res } = await DarajaQuery.stkQuery({ businessShortCode: bsc, checkoutRequestId: checkout, passkey: perKey });

    return ok({
      businessShortCode: bsc,
      checkoutRequestId: checkout,
      result: res,
    });
  } catch (e: any) {
    logger.error({ action: 'stkQuery:error', error: String(e) });
    return fail('internal error', 500);
  }
}

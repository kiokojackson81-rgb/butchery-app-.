import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

function maskMsisdn(msisdn?: string | null){
  if (!msisdn) return '';
  const s = String(msisdn);
  return `***${s.slice(-3)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const receipt = (url.searchParams.get('receipt') || '').trim();

  const keyHeader = req.headers.get('x-admin-key') || req.headers.get('x-api-key');
  const allow = process.env.ADMIN_API_KEY || process.env.ADMIN_REPLAY_KEY || process.env.DARAJA_REPLAY_KEY;
  if (allow && keyHeader !== allow) return fail('forbidden', 403);

  if (!receipt) return fail('missing receipt');

  try {
    const p = await (prisma as any).payment.findFirst({
      where: { mpesaReceipt: receipt },
      select: {
        id: true,
        createdAt: true,
        outletCode: true,
        amount: true,
        status: true,
        mpesaReceipt: true,
        businessShortCode: true,
        storeNumber: true,
        headOfficeNumber: true,
        accountReference: true,
        msisdn: true,
        rawPayload: true,
      },
    });

    if (!p) return ok({ found: false });

    const item = {
      id: p.id,
      createdAt: p.createdAt,
      outlet: p.outletCode,
      amount: p.amount,
      status: p.status,
      receipt: p.mpesaReceipt,
      businessShortCode: p.businessShortCode || p.storeNumber || p.headOfficeNumber || null,
      accountReference: p.accountReference || null,
      msisdnMasked: maskMsisdn(p.msisdn),
      rawPayload: p.rawPayload || null,
    };

    return ok({ found: true, item });
  } catch (e: any) {
    return fail('internal error', 500);
  }
}

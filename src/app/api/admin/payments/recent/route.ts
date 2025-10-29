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
  // Simple admin header guard (avoid exposing PII publicly)
  const keyHeader = req.headers.get('x-admin-key') || req.headers.get('x-api-key');
  const allow = process.env.ADMIN_API_KEY || process.env.ADMIN_REPLAY_KEY || process.env.DARAJA_REPLAY_KEY;
  if (allow && keyHeader !== allow) return fail('forbidden', 403);

  try {
    const rows = await (prisma as any).payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
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
      },
    });

    const data = rows.map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      outlet: r.outletCode,
      amount: r.amount,
      status: r.status,
      receipt: r.mpesaReceipt || null,
      businessShortCode: r.businessShortCode || r.storeNumber || r.headOfficeNumber || null,
      accountReference: r.accountReference || null,
      msisdnMasked: maskMsisdn(r.msisdn),
    }));

    return ok({ count: data.length, items: data });
  } catch (e: any) {
    return fail('internal error', 500);
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data?: any){ return NextResponse.json({ ok: true, ...(data ? { data } : {}) }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

// Safaricom Daraja TransactionStatus ResultURL callback
// We store the raw payload for audit and reconciliation.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = body?.Result || body;

    let note: string | undefined = undefined;
    try {
      const rp = result?.ResultParameters?.ResultParameter as Array<{ Key: string; Value: any }> | undefined;
      const byKey = (k: string) => rp?.find(p => p.Key?.toLowerCase() === k.toLowerCase())?.Value;
      note = result?.TransactionID || byKey('ReceiptNo') || byKey('TransactionID') || undefined;
    } catch {}

    await (prisma as any).c2BDeadLetter.create({
      data: { reason: 'TXSTATUS', rawPayload: body, note }
    });
    return ok();
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data?: any){ return NextResponse.json({ ok: true, ...(data ? { data } : {}) }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

// Safaricom Daraja TransactionStatus QueueTimeOutURL callback
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    try {
      await (prisma as any).c2BDeadLetter.create({
        data: { reason: 'TXSTATUS_TIMEOUT', rawPayload: body }
      });
    } catch (e: any) {
      console.error('txstatus:timeout-store-failed', { error: String(e) });
    }
    return ok();
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

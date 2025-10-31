import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

// Admin-only: fetch recent TransactionStatus callbacks from C2BDeadLetter store
// GET ?transId=TJV3K8XD19&take=20
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const transId = (url.searchParams.get('transId') || '').trim();
    const take = Math.min(parseInt(url.searchParams.get('take') || '20', 10) || 20, 200);

    const keyHeader = req.headers.get('x-admin-key') || req.headers.get('x-api-key');
    const allow = process.env.ADMIN_API_KEY || process.env.ADMIN_REPLAY_KEY || process.env.DARAJA_REPLAY_KEY;
    if (allow && keyHeader !== allow) return fail('forbidden', 403);

    // Query by note (we saved TransactionID/ReceiptNo in note field in result route)
    let rows: any[] = [];
    if (transId) {
      rows = await (prisma as any).c2BDeadLetter.findMany({
        where: { reason: { in: ['TXSTATUS', 'TXSTATUS_TIMEOUT'] }, note: transId },
        orderBy: { receivedAt: 'desc' },
        take,
      });
      // If no direct note match found, surface latest TXSTATUS entries for operator visibility
      if (!rows.length) {
        rows = await (prisma as any).c2BDeadLetter.findMany({
          where: { reason: { in: ['TXSTATUS', 'TXSTATUS_TIMEOUT'] } },
          orderBy: { receivedAt: 'desc' },
          take,
        });
      }
    } else {
      rows = await (prisma as any).c2BDeadLetter.findMany({
        where: { reason: { in: ['TXSTATUS', 'TXSTATUS_TIMEOUT'] } },
        orderBy: { receivedAt: 'desc' },
        take,
      });
    }

    return ok({ count: rows.length, rows });
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

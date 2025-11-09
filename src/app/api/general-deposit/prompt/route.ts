import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendGeneralDepositPrompt } from '@/server/wa_general_deposit';
import { isGeneralDepositAttendant } from '@/server/general_deposit';
import { getPhoneByCode } from '@/lib/wa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const outletName = String(body.outlet || body.outletName || body.outletCode || '').trim();
    const attendantCode = String(body.attendant || body.attendantCode || '').trim().toUpperCase();
    if (!outletName) return fail('outlet required');
    if (!attendantCode) return fail('attendantCode required');

    const isSpecial = await isGeneralDepositAttendant(attendantCode);
    if (!isSpecial) return fail('attendant is not in general-deposit allow-list');

    // Resolve attendant phone; prefer mapping; fallback to provided phone
    let phone = body.phone || null;
    if (!phone) {
      phone = await getPhoneByCode({ role: 'ATTENDANT', code: attendantCode, outlet: outletName });
    }
    if (!phone) return fail('no phone for attendant');
    const phoneE164 = String(phone).startsWith('+') ? String(phone) : ('+' + String(phone));

    const res = await sendGeneralDepositPrompt({ attendantCode, outletName, phoneE164 });
    if (!(res as any).ok) return fail((res as any).error || 'send failed');
    return ok({ attendantCode, outletName, amount: (res as any).amount, link: (res as any).link, waMessageId: (res as any).waMessageId });
  } catch (e:any) {
    return fail('internal error', 500);
  }
}

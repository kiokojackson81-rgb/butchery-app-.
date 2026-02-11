import { NextResponse } from 'next/server';
import sendWhatsAppTemplateMessage from '@/lib/whatsapp/sendTemplate';
import { computeDayTotals } from '@/server/finance';
import { outletLabel } from '@/lib/whatsapp/recipients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key') || '';
    const expected = process.env.ADMIN_DIAG_KEY || '';
    if (!expected || key !== expected) return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403 });

    const to = (url.searchParams.get('to') || '').replace(/^\+/, '');
    const outlet = (url.searchParams.get('outlet') || 'BARAKA_A') as any;
    if (!to) return NextResponse.json({ ok: false, error: 'missing to' }, { status: 400 });

    const date = new Date().toISOString().slice(0,10);
    const stats = await computeDayTotals({ date, outletName: outletLabel(outlet) as string });
    const total = Math.round(stats.tillSalesGross || 0);
    const count = Array.isArray((stats as any).payments) ? (stats as any).payments.length : (total ? 1 : 0);

    const res = await sendWhatsAppTemplateMessage({
      to,
      templateName: 'till_balance_response',
      bodyParams: [ outletLabel(outlet), date, String(total), String(count) ],
    });

    return NextResponse.json({ ok: true, result: res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

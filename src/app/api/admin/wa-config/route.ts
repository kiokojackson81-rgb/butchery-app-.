export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from 'next/server';

export async function GET() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const lang = process.env.WA_TEMPLATE_LANG || 'en';
  const tplBalance = process.env.WA_TEMPLATE_NAME_BALANCE || null;
  const tplHigh = process.env.WA_TEMPLATE_NAME_HIGH_VALUE || null;
  const tplMid = process.env.WA_TEMPLATE_NAME_MIDNIGHT || null;
  const phoneLast4 = phoneId.slice(-4);

  return NextResponse.json({ ok: true, phoneLast4, lang, templates: { balance: tplBalance, high_value: tplHigh, midnight: tplMid } });
}

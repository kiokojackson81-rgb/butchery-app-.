import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const waEnabled = String(process.env.WA_DARAJA_ENABLED || 'true').toLowerCase() === 'true';
  const live = String(process.env.DARAJA_LIVE_MODE || 'false').toLowerCase() === 'true';
  const base = live ? (process.env.DARAJA_BASE_URL || 'https://api.safaricom.co.ke') : (process.env.DARAJA_BASE_URL || 'https://sandbox.safaricom.co.ke');
  return NextResponse.json({ ok: true, data: { WA_DARAJA_ENABLED: waEnabled, DARAJA_LIVE_MODE: live, DARAJA_BASE_URL: base } });
}

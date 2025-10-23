import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const waEnabled = String(process.env.WA_DARAJA_ENABLED || 'true').toLowerCase() === 'true';
  const live = String(process.env.DARAJA_LIVE_MODE || 'false').toLowerCase() === 'true';
  // Default to the official production API host when live mode is enabled.
  // `DARAJA_BASE_URL` may be overridden in env for stalls or special routing.
  const base = process.env.DARAJA_BASE_URL || (live ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
  return NextResponse.json({ ok: true, data: { WA_DARAJA_ENABLED: waEnabled, DARAJA_LIVE_MODE: live, DARAJA_BASE_URL: base } });
}

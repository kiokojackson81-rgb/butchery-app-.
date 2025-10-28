import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, ...data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function GET() {
  try {
    const baseUrl = process.env.DARAJA_BASE_URL || '';
    const darajaEnabled = String(process.env.WA_DARAJA_ENABLED ?? 'true').toLowerCase() === 'true';
    const liveMode = String(process.env.DARAJA_LIVE_MODE ?? 'false').toLowerCase() === 'true';
    const publicBaseUrlSet = Boolean(process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.length > 0);

    const haveHoPasskey = Boolean(process.env.DARAJA_PASSKEY_HO && process.env.DARAJA_PASSKEY_HO.length > 0);

    // Collect any per-till passkeys without revealing values
    const perTill = Object.keys(process.env)
      .filter((k) => /^DARAJA_PASSKEY_\d{4,}$/.test(k) && k !== 'DARAJA_PASSKEY_HO')
      .map((k) => k.replace('DARAJA_PASSKEY_', ''));

    return ok({
      flags: {
        darajaEnabled,
        liveMode,
      },
      baseUrl,
      publicBaseUrlSet,
      passkeys: {
        haveHoPasskey,
        perTillShortcodes: perTill,
      },
    });
  } catch (e: any) {
    return fail('internal error', 500);
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { resolveOutletForCategory } from '@/lib/category_router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedOutletCodes = ['BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL'];

function fail(msg: string, code = 400){ return NextResponse.json({ ok: false, error: msg }, { status: code }); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const outletCode = url.searchParams.get('outletCode') || '';
    const category = url.searchParams.get('category') || undefined;
    if (!outletCode) return fail('outletCode required');

    const normalizedRequestedOutlet = String(outletCode).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!allowedOutletCodes.includes(normalizedRequestedOutlet)) {
      return fail(`invalid outletCode '${outletCode}'. expected one of: ${allowedOutletCodes.join(', ')}`, 400);
    }

    const finalOutlet = category ? resolveOutletForCategory(category, normalizedRequestedOutlet) : normalizedRequestedOutlet;

  let till = await (prisma as any).till.findFirst({ where: { outletCode: finalOutlet, isActive: true } });
    let fallback = false;
    if (!till) {
      logger.info({ action: 'stkResolve:info', message: 'no till for outlet, falling back to GENERAL', requestedOutlet: finalOutlet });
  const gen = await (prisma as any).till.findFirst({ where: { outletCode: 'GENERAL', isActive: true } });
      if (!gen) return fail('no till configured for outlet and no GENERAL fallback', 404);
      till = gen;
      fallback = true;
    }

    const storeShortcode = till.storeNumber;
    const headOfficeShortcode = till.headOfficeNumber;
    const passkeyKey = `DARAJA_PASSKEY_${storeShortcode}`;
    const perTillPasskey = (process.env as any)[passkeyKey];
    const useShortcode = perTillPasskey ? storeShortcode : headOfficeShortcode;

    return NextResponse.json({ ok: true, requestedOutlet: normalizedRequestedOutlet, outletUsed: till.outletCode, fallback, storeNumber: storeShortcode, headOfficeNumber: headOfficeShortcode, businessShortCode: useShortcode });
  } catch (e: any) {
    logger.error({ action: 'stkResolve:error', error: String(e) });
    return fail('internal error', 500);
  }
}

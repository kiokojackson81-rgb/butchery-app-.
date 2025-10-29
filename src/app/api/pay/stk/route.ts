import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DarajaClient } from '@/lib/daraja_client';
import logger from '@/lib/logger';
import { resolveOutletForCategory } from '@/lib/category_router';

const WA_DARAJA_ENABLED = String(process.env.WA_DARAJA_ENABLED ?? 'true').toLowerCase() === 'true';
const DARAJA_LIVE_MODE = String(process.env.DARAJA_LIVE_MODE ?? 'false').toLowerCase() === 'true';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Export a mutable prisma binding so tests can inject a mock via the module namespace.
let localPrisma: any = prisma;
export function setPrisma(p: any){ localPrisma = p; }

type Body = { outletCode: string; phone: string; amount: number; accountRef?: string; description?: string; category?: string };

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function POST(req: Request) {
  try {
    if (!WA_DARAJA_ENABLED) return NextResponse.json({ ok: false, error: 'Daraja disabled' }, { status: 400 });
    const body = await req.json() as Body;
    const { outletCode, phone, amount } = body;
    if (!outletCode) return fail('outletCode required');
    // Normalize and validate outlet code against Prisma enum OutletCode
    const allowedOutletCodes = ['BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL'];
    const normalizedRequestedOutlet = String(outletCode).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!allowedOutletCodes.includes(normalizedRequestedOutlet)) {
      return fail(`invalid outletCode '${outletCode}'. expected one of: ${allowedOutletCodes.join(', ')}`, 400);
    }
    if (!phone || !/^2547\d{8}$/.test(phone)) return fail('phone must be E.164 MSISDN starting with 2547...');
    if (!amount || Number(amount) <= 0) return fail('amount must be > 0');

    // allow category-based override
  const finalOutlet = body['category'] ? resolveOutletForCategory((body as any).category, normalizedRequestedOutlet) : normalizedRequestedOutlet;

    // Resolve till by outlet code. If none configured for this outlet, fall back to GENERAL till
  let till = await (localPrisma as any).till.findFirst({ where: { outletCode: finalOutlet, isActive: true } });
    let usedOutlet = finalOutlet;
    let usedFallback = false;
    if (!till) {
      logger.info({ action: 'stkPush:info', message: 'no till for outlet, falling back to GENERAL', requestedOutlet: finalOutlet });
      const gen = await (localPrisma as any).till.findFirst({ where: { outletCode: 'GENERAL', isActive: true } });
      if (!gen) return fail('no till configured for outlet and no GENERAL fallback', 404);
      till = gen;
      usedOutlet = 'GENERAL';
      usedFallback = true;
    }

    // Choose signing shortcode / passkey behavior
    const storeShortcode = till.storeNumber;
    const headOfficeShortcode = till.headOfficeNumber;

    // If a per-till passkey env exists, we treat this as a BuyGoods STK (LNMO) and sign with the store till.
    // Otherwise, fall back to HO PayBill with PayBill transaction type and route funds to HO.
    const passkeyKey = `DARAJA_PASSKEY_${storeShortcode}`;
    const perTillPasskey = (process.env as any)[passkeyKey];
    const isBuyGoods = !!perTillPasskey; // only safe when we can sign with the store till passkey
    const useShortcode = isBuyGoods ? storeShortcode : headOfficeShortcode;
    const partyB = isBuyGoods ? storeShortcode : useShortcode; // BG: store till, HO fallback: HO

    // Create PENDING payment row
    const payment = await (localPrisma as any).payment.create({ data: {
      outletCode: usedOutlet,
      amount: Number(amount),
      msisdn: phone,
      status: 'PENDING',
      businessShortCode: useShortcode,
      partyB: partyB,
      storeNumber: storeShortcode,
      headOfficeNumber: headOfficeShortcode,
      accountReference: body.accountRef || undefined,
      description: body.description || undefined,
    }});

    // Ensure callback base URL is present (daraja client requires it)
    if (!process.env.PUBLIC_BASE_URL) {
      logger.error({ action: 'stkPush:error', error: 'PUBLIC_BASE_URL not configured' });
      // mark payment failed so attendants can retry
      try {
        await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { status: 'FAILED', description: 'SERVER_MISCONFIGURED: missing PUBLIC_BASE_URL' } });
      } catch (e) {}
      return fail('server misconfigured: PUBLIC_BASE_URL required', 500);
    }

    // Initiate STK (Daraja errors are handled separately so we can update DB and log stack)
    logger.info({ action: 'stkPush:request', outletCode: finalOutlet, msisdn: phone, amount, shortcode: useShortcode });
    try {
  const stkRes = await DarajaClient.stkPush({ businessShortCode: useShortcode, amount: Number(amount), phoneNumber: phone, accountReference: body.accountRef, transactionDesc: body.description, partyB, passkey: perTillPasskey, transactionType: isBuyGoods ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline' });
      logger.info({ action: 'stkPush:response', outletCode: finalOutlet, msisdn: phone, res: stkRes.res });

      // Persist merchant and checkout ids if present
      const merchantRequestId = (stkRes.res as any).MerchantRequestID || null;
      const checkoutRequestId = (stkRes.res as any).CheckoutRequestID || null;
      if (merchantRequestId || checkoutRequestId) {
        await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { merchantRequestId, checkoutRequestId } });
      }

  const msg = usedFallback ? `STK initiated via GENERAL till (fallback).` : 'STK initiated';
  return ok({ message: msg, checkoutRequestId, outletUsed: usedOutlet, fallback: usedFallback });
    } catch (err: any) {
      // Log full error with stack for Vercel logs and mark payment FAILED with message
      logger.error({ action: 'stkPush:error', error: err?.message ?? String(err), stack: err?.stack });
      try {
        await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { status: 'FAILED', description: String(err?.message || 'stk error').slice(0, 1024) } });
      } catch (e) {
        logger.error({ action: 'stkPush:error:updatePayment', error: String(e) });
      }
      // If Daraja client attached payload (darajaPost), surface it lightly
      const payload = err?.payload ? (typeof err.payload === 'string' ? err.payload : JSON.stringify(err.payload)) : undefined;
      return NextResponse.json({ ok: false, error: 'daraja error', details: err?.message, payload, outletUsed: usedOutlet, fallback: usedFallback }, { status: 502 });
    }
  } catch (e: any) {
    logger.error({ action: 'stkPush:error', error: String(e) });
    return fail('internal error', 500);
  }
}

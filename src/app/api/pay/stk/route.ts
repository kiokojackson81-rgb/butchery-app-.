import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DarajaClient } from '@/lib/daraja_client';
import logger from '@/lib/logger';
import { resolveOutletForCategory } from '@/lib/category_router';

const WA_DARAJA_ENABLED = String(process.env.WA_DARAJA_ENABLED ?? 'true').toLowerCase() === 'true'; // No change
const DARAJA_LIVE_MODE = String(process.env.DARAJA_LIVE_MODE ?? 'false').toLowerCase() === 'true'; // No change

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Export a mutable prisma binding so tests can inject a mock via the module namespace.
let localPrisma: any = prisma;
export function setPrisma(p: any){ localPrisma = p; }

type Body = { outletCode: string; phone: string; amount: number; accountRef?: string; description?: string; category?: string; mode?: string; attendantCode?: string };

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

async function handleStk(body: Body, req: Request) {
  try {
    if (!WA_DARAJA_ENABLED) return NextResponse.json({ ok: false, error: 'Daraja disabled' }, { status: 400 });
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
  // Special mode: GENERAL_DEPOSIT forces GENERAL till usage regardless of outlet
  const requestedMode = String(body.mode || '').toUpperCase();
  const isGeneralDepositMode = requestedMode === 'GENERAL_DEPOSIT';
  const finalOutlet = isGeneralDepositMode
    ? 'GENERAL'
    : (body['category'] ? resolveOutletForCategory((body as any).category, normalizedRequestedOutlet) : normalizedRequestedOutlet);

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
  // Correct mapping per Safaricom guidance:
  // - Till Number (where customers pay) = till.tillNumber → used as PartyB for BuyGoods flows
  // - Store Number (internal store id)   = till.storeNumber → persisted for reference only
  // - HO shortcode (PayBill)             = till.headOfficeNumber
  const childTillShortcode = till.tillNumber;           // Child BuyGoods TILL (PartyB)
  const storeNumber = till.storeNumber;                 // Store id (do NOT use as PartyB)
  const headOfficeShortcode = till.headOfficeNumber;    // HO PayBill

    // Env-based overrides / availability
  const passkeyKey = `DARAJA_PASSKEY_${childTillShortcode}`;     // Per-till passkey (if configured)
    const perTillPasskey = (process.env as any)[passkeyKey];     // Per-till passkey (if configured) // No change
    const hoPasskey = process.env.DARAJA_PASSKEY_HO;               // HO passkey (usually provided by Safaricom)
    const forcePaybill = String(process.env.DARAJA_FORCE_PAYBILL ?? 'false').toLowerCase() === 'true'; // No change

    // Non-secret diagnostics to aid production troubleshooting
    logger.info({
      action: 'stkPush:env',
      outletCode: usedOutlet,
      hasHoPasskey: !!hoPasskey,
      hasPerTillPasskey: !!perTillPasskey,
      forcePaybill,
      childTillShortcode,
      storeNumber,
      headOfficeShortcode,
    });

    // Mode selection (in order of preference):
  // 1) Per-till passkey present: sign with child till, BuyGoods; BusinessShortCode=till, PartyB=till.
    // 2) HO passkey present and not forcing PayBill: Safaricom guidance for HO+child tills →
    //    sign with HO, TransactionType=CustomerBuyGoodsOnline, PartyB=store till.
    // 3) Fallback: PayBill mode with HO (CustomerPayBillOnline), PartyB=HO.
    let mode: 'BG_PER_TILL' | 'BG_HO_SIGN' | 'PAYBILL_HO' = 'PAYBILL_HO';
    if (perTillPasskey) {
      mode = 'BG_PER_TILL';
    } else if (hoPasskey && childTillShortcode && !forcePaybill) {
      mode = 'BG_HO_SIGN';
    }

    // Admin-only override: allow forcing a mode for investigative runs
    try {
      const adminKeyHeader = req.headers.get('x-admin-key') || '';
      const adminKeyEnv = process.env.ADMIN_API_KEY || '';
      if (adminKeyHeader && adminKeyEnv && adminKeyHeader === adminKeyEnv) {
        const raw = await req.clone().json().catch(() => ({} as any));
        const requestedMode = (raw?.mode || '').toString().toUpperCase();
        if (requestedMode === 'BG_HO_SIGN' || requestedMode === 'PAYBILL_HO' || requestedMode === 'BG_PER_TILL') {
          mode = requestedMode as any;
          logger.info({ action: 'stkPush:override', mode });
        }
      }
    } catch (_) {
      // ignore override errors; proceed with computed mode
    }

  const useShortcode = mode === 'BG_PER_TILL' ? childTillShortcode : headOfficeShortcode;
  const partyB = mode === 'PAYBILL_HO' ? headOfficeShortcode : (childTillShortcode || headOfficeShortcode);

    // Create PENDING payment row
    const payment = await (localPrisma as any).payment.create({ data: {
      outletCode: usedOutlet,
      amount: Number(amount),
      msisdn: phone,
      status: 'UNPAID',
      businessShortCode: useShortcode,
      partyB: partyB,
  storeNumber: storeNumber,
      headOfficeNumber: headOfficeShortcode,
      accountReference: isGeneralDepositMode
        ? (body.accountRef || (body.attendantCode ? `DEP_${String(body.attendantCode).toUpperCase()}` : 'DEP_GENERAL'))
        : (body.accountRef || undefined),
      description: isGeneralDepositMode
        ? (body.description || 'Deposit for general items')
        : (body.description || undefined),
    }});

    // Ensure callback base URL is present (daraja client requires it)
    if (!process.env.PUBLIC_BASE_URL) {
      logger.error({ action: 'stkPush:error', error: 'PUBLIC_BASE_URL not configured' });
      // mark payment failed so attendants can retry
      try {
        await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { status: 'UNPAID', description: 'SERVER_MISCONFIGURED: missing PUBLIC_BASE_URL' } });
      } catch (e) {}
      return fail('server misconfigured: PUBLIC_BASE_URL required', 500);
    }

    // Initiate STK (Daraja errors are handled separately so we can update DB and log stack)
  logger.info({ action: 'stkPush:request', outletCode: finalOutlet, msisdn: phone, amount, shortcode: useShortcode, mode, partyB, generalDepositMode: isGeneralDepositMode });
    try {
      const transactionType = mode === 'PAYBILL_HO' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline';
      // Passkey param: per-till when BG_PER_TILL; undefined uses HO passkey via env fallback
      const passkeyParam = mode === 'BG_PER_TILL' ? perTillPasskey : undefined;
      const stkRes = await DarajaClient.stkPush({
        businessShortCode: useShortcode,
        amount: Number(amount),
        phoneNumber: phone,
        accountReference: body.accountRef,
        transactionDesc: body.description,
        partyB,
        passkey: passkeyParam,
        transactionType,
      });
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
        await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { status: 'UNPAID', description: String(err?.message || 'stk error').slice(0, 1024) } });
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Body));
  return handleStk(body, req);
}

export async function GET(req: Request) {
  // Allow GET deep link trigger via query params (used from WhatsApp links)
  const { searchParams } = new URL(req.url);
  const body: Body = {
    outletCode: String(searchParams.get('outletCode') || searchParams.get('outlet') || ''),
    phone: String(searchParams.get('phone') || ''),
    amount: Number(searchParams.get('amount') || 0),
    accountRef: searchParams.get('accountRef') || undefined,
    description: searchParams.get('description') || undefined,
    category: searchParams.get('category') || undefined,
    mode: searchParams.get('mode') || undefined,
    attendantCode: searchParams.get('attendantCode') || undefined,
  } as any;
  return handleStk(body, req);
}

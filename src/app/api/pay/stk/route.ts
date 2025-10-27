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
    if (!phone || !/^2547\d{8}$/.test(phone)) return fail('phone must be E.164 MSISDN starting with 2547...');
    if (!amount || Number(amount) <= 0) return fail('amount must be > 0');

    // allow category-based override
    const finalOutlet = body['category'] ? resolveOutletForCategory((body as any).category, outletCode) : outletCode;

    // Resolve till by outlet code
  const till = await (localPrisma as any).till.findFirst({ where: { outletCode: finalOutlet, isActive: true } });
    if (!till) return fail('no till configured for outlet', 404);

    // Choose signing shortcode / passkey behavior
    const storeShortcode = till.storeNumber;
    const headOfficeShortcode = till.headOfficeNumber;

    // If a per-till passkey env exists, sign with store; else sign with HO
    const passkeyKey = `DARAJA_PASSKEY_${storeShortcode}`;
    const perTillPasskey = (process.env as any)[passkeyKey];
    const useShortcode = perTillPasskey ? storeShortcode : headOfficeShortcode;
    const partyB = storeShortcode; // funds go to store till

    // Create PENDING payment row
    const payment = await (localPrisma as any).payment.create({ data: {
      outletCode: finalOutlet,
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

    // Initiate STK
  logger.info({ action: 'stkPush:request', outletCode: finalOutlet, msisdn: phone, amount, shortcode: useShortcode });
  const stkRes = await DarajaClient.stkPush({ businessShortCode: useShortcode, amount: Number(amount), phoneNumber: phone, accountReference: body.accountRef, transactionDesc: body.description, partyB });
  logger.info({ action: 'stkPush:response', outletCode: finalOutlet, msisdn: phone, res: stkRes.res });

    // Persist merchant and checkout ids if present
    const merchantRequestId = (stkRes.res as any).MerchantRequestID || null;
    const checkoutRequestId = (stkRes.res as any).CheckoutRequestID || null;
    if (merchantRequestId || checkoutRequestId) {
  await (localPrisma as any).payment.update({ where: { id: payment.id }, data: { merchantRequestId, checkoutRequestId } });
    }

    return ok({ message: 'STK initiated', checkoutRequestId });
  } catch (e: any) {
    logger.error({ action: 'stkPush:error', error: String(e) });
    return fail('internal error', 500);
  }
}

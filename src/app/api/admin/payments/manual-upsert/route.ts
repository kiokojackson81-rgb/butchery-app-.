import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

// Admin-only endpoint to manually persist a C2B payment when Safaricom did not deliver the callback.
// Body: { receipt: string; amount: number; shortcode?: string; outlet?: string; msisdn?: string; accountRef?: string; when?: string }
// Auth: x-admin-key must match ADMIN_API_KEY or ADMIN_REPLAY_KEY (same convention as other admin endpoints)
export async function POST(req: Request) {
  try {
    const keyHeader = req.headers.get('x-admin-key') || req.headers.get('x-api-key');
    const allow = process.env.ADMIN_API_KEY || process.env.ADMIN_REPLAY_KEY || process.env.DARAJA_REPLAY_KEY;
    if (allow && keyHeader !== allow) return fail('forbidden', 403);

    const body = await req.json().catch(() => ({}));
    const receipt = String(body.receipt || body.mpesaReceipt || '').trim();
    const amount = Number(body.amount || 0);
    const shortcode = String(body.shortcode || body.shortCode || body.businessShortCode || '').trim();
    const msisdn = String(body.msisdn || '').trim() || undefined;
    const outlet = String(body.outlet || body.outletCode || '').trim().toUpperCase() || undefined;
    const accountRef = String(body.accountRef || body.billRef || body.billRefNumber || '').trim() || undefined;
    const when = String(body.when || '').trim();

    if (!receipt) return fail('receipt required');
    if (!amount || amount <= 0) return fail('amount must be > 0');

    // If a row already exists with this receipt, return it (idempotent)
    const existing = await (prisma as any).payment.findFirst({ where: { mpesaReceipt: receipt } });
    if (existing) return ok({ id: existing.id, already: true, payment: existing });

    // Resolve outlet by shortcode if not explicitly provided
    let outletCode = outlet as any;
    let storeNumber: string | undefined;
    let headOfficeNumber: string | undefined;
    let businessShortCode: string | undefined;
    if (!outletCode && shortcode) {
      const t = await (prisma as any).till.findFirst({ where: { OR: [ { tillNumber: shortcode }, { storeNumber: shortcode }, { headOfficeNumber: shortcode } ], isActive: true } });
      if (t?.outletCode) outletCode = t.outletCode;
      storeNumber = t?.storeNumber || undefined;
      headOfficeNumber = t?.headOfficeNumber || undefined;
      businessShortCode = t?.tillNumber || shortcode;
    } else {
      businessShortCode = shortcode || undefined;
    }
    if (!outletCode) outletCode = 'GENERAL';

    const created = await (prisma as any).payment.create({
      data: {
        outletCode,
        amount: Math.round(amount),
        msisdn,
        status: 'SUCCESS',
        mpesaReceipt: receipt,
        businessShortCode,
        partyB: businessShortCode,
        storeNumber: storeNumber || undefined,
        headOfficeNumber: headOfficeNumber || undefined,
        accountReference: accountRef,
        description: 'MANUAL_UPSERT',
        createdAt: when ? new Date(when) : undefined,
      }
    });
    return ok(created);
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

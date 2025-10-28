import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fail(msg: string, code = 400) { return NextResponse.json({ ok: false, error: msg }, { status: code }); }

export async function POST(req: Request) {
  try {
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return fail('forbidden', 403);

    const body = await req.json().catch(()=>({}));
    const mpesaReceipt = String(body.mpesaReceipt || body.receipt || '').trim();
    const outletCode = String(body.outletCode || '').trim().toUpperCase();
    if (!mpesaReceipt) return fail('missing mpesaReceipt');
    if (!outletCode) return fail('missing outletCode');

    // Update the payment by receipt if present
    const existing = await (prisma as any).payment.findFirst({ where: { mpesaReceipt } });
    if (!existing) return fail('payment_not_found', 404);

    const updated = await (prisma as any).payment.update({
      where: { id: existing.id },
      data: { outletCode },
      select: { id: true, outletCode: true, amount: true, mpesaReceipt: true, status: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, payment: updated });
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

export async function GET(req: Request) {
  try {
    const adminHeader = req.headers.get('x-admin-auth');
    if (adminHeader !== 'true') return fail('forbidden', 403);
    const { searchParams } = new URL(req.url);
    const receipt = (searchParams.get('receipt') || '').trim();
    if (!receipt) return fail('missing receipt');
    const p = await (prisma as any).payment.findFirst({ where: { mpesaReceipt: receipt }, select: { id: true, outletCode: true, amount: true, status: true, createdAt: true } });
    if (!p) return fail('payment_not_found', 404);
    return NextResponse.json({ ok: true, payment: p });
  } catch (e: any) {
    return fail(String(e) || 'error', 500);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(data: any){ return NextResponse.json({ ok: true, data }); }
function fail(error: string, code = 400){ return NextResponse.json({ ok: false, error }, { status: code }); }

export async function POST(req: Request) {
  const adminKey = process.env.ADMIN_REPLAY_KEY || process.env.DARAJA_REPLAY_KEY;
  const hdrKey = req.headers.get('x-admin-key') || req.headers.get('x-replay-key');
  if (adminKey && hdrKey !== adminKey) return fail('forbidden', 403);

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object') return fail('invalid body');

  const short = String((body as any).ShortCode || (body as any).BusinessShortCode || (body as any).Shortcode || (body as any).shortCode || "");
  const amountRaw = (body as any).TransAmount || (body as any).Amount || (body as any).TransactionAmount || (body as any).AmountPaid || 0;
  const amount = Math.round(Number(amountRaw) || 0);
  const msisdn = String((body as any).MSISDN || (body as any).msisdn || (body as any).CustomerMSISDN || "");
  const receipt = String((body as any).TransID || (body as any).MerchantRequestID || (body as any).MpesaReceiptNumber || (body as any).Receipt || "");
  const accountReference = String((body as any).BillRefNumber || (body as any).AccountReference || (body as any).billRefNumber || (body as any).BillRef || "");

  let outletCode = (process.env.DEFAULT_OUTLET_CODE || "GENERAL") as any;
  let storeNumber = "";
  let headOfficeNumber = "";
  if (short) {
    try {
      const t = await (prisma as any).till.findFirst({
        where: { isActive: true, OR: [ { tillNumber: short }, { storeNumber: short }, { headOfficeNumber: short } ] },
      });
      if (t) {
        if (t.outletCode) outletCode = t.outletCode;
        storeNumber = t.storeNumber || "";
        headOfficeNumber = t.headOfficeNumber || "";
      }
    } catch {}
  }

  if (!short || !amount || amount <= 0) return ok({ skipped: true, reason: 'invalid payload', short, amount, receipt });

  if (receipt) {
    const existing = await (prisma as any).payment.findFirst({ where: { mpesaReceipt: receipt } });
    if (existing) {
      const updated = await (prisma as any).payment.update({
        where: { id: existing.id },
        data: {
          outletCode,
          amount,
          msisdn: msisdn || existing.msisdn || undefined,
          status: "SUCCESS",
          businessShortCode: short || existing.businessShortCode || "",
          partyB: short || existing.partyB || "",
          storeNumber: storeNumber || existing.storeNumber || short || "",
          headOfficeNumber: headOfficeNumber || existing.headOfficeNumber || short || "",
          accountReference: accountReference || existing.accountReference || undefined,
          description: (body as any).Description || (body as any).Remarks || existing.description || undefined,
          rawPayload: body || existing.rawPayload || {},
        },
      });
      return ok({ updated: updated.id, receipt });
    }
  }

  const created = await (prisma as any).payment.create({
    data: {
      outletCode,
      amount,
      msisdn: msisdn || undefined,
      status: "SUCCESS",
      mpesaReceipt: receipt || undefined,
      businessShortCode: short || "",
      partyB: short || "",
      storeNumber: storeNumber || short || "",
      headOfficeNumber: headOfficeNumber || short || "",
      accountReference: accountReference || undefined,
      description: (body as any).Description || (body as any).Remarks || undefined,
      rawPayload: body || {},
    },
  });
  return ok({ created: created.id, receipt: receipt || null });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  console.log("C2B CONFIRM:", body);

  try {
    // Normalize commonly seen fields from various C2B payload shapes
    const short = String(body.ShortCode || body.BusinessShortCode || body.Shortcode || body.shortCode || "");
    const amountRaw = body.TransAmount || body.Amount || body.TransactionAmount || body.AmountPaid || 0;
    const amount = Math.round(Number(amountRaw) || 0);
    const msisdn = String(body.MSISDN || body.msisdn || body.CustomerMSISDN || "");
    const receipt = String(body.TransID || body.MerchantRequestID || body.MpesaReceiptNumber || body.Receipt || "");
    const accountReference = String(body.BillRefNumber || body.AccountReference || body.billRefNumber || body.BillRef || "");

    // Try to map the short code to a seeded Till record to pick an outletCode
    let outletCode = (process.env.DEFAULT_OUTLET_CODE || "GENERAL") as any;
    if (short) {
      try {
        const t = await (prisma as any).till.findUnique({ where: { tillNumber: short } });
        if (t && t.outletCode) outletCode = t.outletCode;
      } catch (e) {
        console.warn("[daraja confirm] till lookup failed", String(e));
      }
    }

    // Create a Payment row (rawPayload kept for traceability)
    try {
      await (prisma as any).payment.create({
        data: {
          outletCode,
          amount: amount,
          msisdn: msisdn || undefined,
          status: "SUCCESS",
          mpesaReceipt: receipt || undefined,
          businessShortCode: short || "",
          accountReference: accountReference || undefined,
          description: body.Description || body.Remarks || undefined,
          rawPayload: body || {},
        },
      });
      console.log("C2B saved payment:", { short, amount, msisdn, receipt, outletCode });
    } catch (e) {
      console.error("C2B saving payment failed:", String(e));
    }
  } catch (e) {
    console.error("C2B processing error:", String(e));
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
export async function GET() { return NextResponse.json({ ok: true }); }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function POST(req: Request) {
  const receivedAt = new Date().toISOString();
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown");
  const rawText = await req.text().catch(() => "");
  let body: any = {};
  try { body = rawText ? JSON.parse(rawText) : {}; } catch {}
  console.log("[C2B/confirm] hit", { receivedAt, ip, len: rawText.length });

  try {
    // Normalize commonly seen fields from various C2B payload shapes
    const short = String(body.ShortCode || body.BusinessShortCode || body.Shortcode || body.shortCode || "");
    const amountRaw = body.TransAmount || body.Amount || body.TransactionAmount || body.AmountPaid || 0;
    const amount = Math.round(Number(amountRaw) || 0);
    const msisdn = String(body.MSISDN || body.msisdn || body.CustomerMSISDN || "");
    const receipt = String(body.TransID || body.MerchantRequestID || body.MpesaReceiptNumber || body.Receipt || "");
    const accountReference = String(body.BillRefNumber || body.AccountReference || body.billRefNumber || body.BillRef || "");

    // Try to map the short code to a seeded Till record to pick an outletCode and related numbers
    let outletCode = (process.env.DEFAULT_OUTLET_CODE || "GENERAL") as any;
    let storeNumber = "";
    let headOfficeNumber = "";
    if (short) {
      try {
        // Map by any of the configured numbers (till, store, or head office) and prefer active tills
        const t = await (prisma as any).till.findFirst({
          where: {
            isActive: true,
            OR: [
              { tillNumber: short },
              { storeNumber: short },
              { headOfficeNumber: short },
            ],
          },
        });
        if (t) {
          if (t.outletCode) outletCode = t.outletCode;
          storeNumber = t.storeNumber || "";
          headOfficeNumber = t.headOfficeNumber || "";
        }
      } catch (e) {
        console.warn("[daraja confirm] till lookup failed", String(e));
      }
    }

    // Basic payload validation: require a short code and positive amount to persist
    if (!short || !amount || amount <= 0) {
      console.warn("[daraja confirm] skipped persist due to invalid payload", { short, amount, receipt });
    } else {
      // Idempotency by mpesaReceipt when provided: update existing else create
      try {
        if (receipt) {
          const existing = await (prisma as any).payment.findFirst({ where: { mpesaReceipt: receipt } });
          if (existing) {
            await (prisma as any).payment.update({
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
                description: body.Description || body.Remarks || existing.description || undefined,
                rawPayload: body || existing.rawPayload || {},
              },
            });
            console.log("C2B updated existing payment by receipt", { receipt, short, amount });
          } else {
            await (prisma as any).payment.create({
              data: {
                outletCode,
                amount,
                msisdn: msisdn || undefined,
                status: "SUCCESS",
                mpesaReceipt: receipt,
                businessShortCode: short || "",
                partyB: short || "",
                storeNumber: storeNumber || short || "",
                headOfficeNumber: headOfficeNumber || short || "",
                accountReference: accountReference || undefined,
                description: body.Description || body.Remarks || undefined,
                rawPayload: body || {},
              },
            });
            console.log("C2B saved payment (new)", { short, amount, msisdn, receipt, outletCode });
          }
        } else {
          await (prisma as any).payment.create({
            data: {
              outletCode,
              amount,
              msisdn: msisdn || undefined,
              status: "SUCCESS",
              businessShortCode: short || "",
              partyB: short || "",
              storeNumber: storeNumber || short || "",
              headOfficeNumber: headOfficeNumber || short || "",
              accountReference: accountReference || undefined,
              description: body.Description || body.Remarks || undefined,
              rawPayload: body || {},
            },
          });
          console.log("C2B saved payment (no receipt)", { short, amount, msisdn, outletCode });
        }
      } catch (e) {
        console.error("C2B saving payment failed:", String(e));
      }
    }
  } catch (e) {
    console.error("C2B processing error:", String(e));
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
export async function GET() { return NextResponse.json({ ok: true }); }

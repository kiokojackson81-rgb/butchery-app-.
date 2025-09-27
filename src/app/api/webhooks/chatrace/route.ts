import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import crypto from "crypto";
import { sendWaText } from "@/lib/wa";
import { prisma } from "@/lib/db";

// Optional: simple guard for minimal abuse protection (token via env)
const SECRET = process.env.CHATRACE_WEBHOOK_SECRET;

function verifySignatureOrToken(raw: string, headers: Headers): boolean {
  if (!SECRET) return true; // no verification configured
  // 1) Prefer HMAC signature if provided
  const sigHeader = headers.get("x-chatrace-signature") || undefined;
  if (sigHeader) {
    const expected = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader)); }
    catch { return false; }
  }
  // 2) Fallback: shared secret token header (backward-compatible)
  const token = headers.get("x-chatrace-secret");
  if (token && token === SECRET) return true;
  return false;
}

export async function POST(req: Request) {
  try {
  const raw = await req.text();
  if (!verifySignatureOrToken(raw, req.headers)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const payload = JSON.parse(raw || "{}");
    const tag = String(payload?.tag || "").toLowerCase();
    const phone = String(payload?.phone || payload?.from || "");

    if (!tag) return NextResponse.json({ ok: false, error: "missing tag" }, { status: 400 });

    switch (tag) {
      case "closing_submitted": {
        const amount = Number(payload?.depositAmount || 0);
        if (phone) await sendWaText(phone, `✅ Closing submitted. Deposit recorded: Ksh ${amount || 0}.`);
        break;
      }
      case "low_stock": {
        const outlet = String(payload?.outlet || "");
        const product = String(payload?.product || "");
        const qty = Number(payload?.qty || 0);
        const suppliers = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier" } });
        const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });
        const msg = `⚠️ Low Stock @ ${outlet || "(unknown)"}: ${product}=${qty}`;
        await Promise.all([
          ...suppliers.map((s: any) => sendWaText(s.phoneE164, msg)),
          ...supervisors.map((s: any) => sendWaText(s.phoneE164, msg)),
        ]);
        if (phone) await sendWaText(phone, "✅ Notified supplier & supervisor.");
        break;
      }
      case "supply_request": {
        const text = String(payload?.text || payload?.message || "");
        const m = /^request\s+([a-zA-Z0-9_-]+)\s+([0-9]+(\.[0-9]+)?)$/i.exec(text.trim());
        if (!m) {
          if (phone) await sendWaText(phone, `Hi! Use: request <itemKey> <qty>. Example: request beef 20`);
          break;
        }
        const productKey = m[1].toLowerCase();
        const qty = Number(m[2]);
        const map = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164: phone } });
        const outlet = map?.outlet || "Unknown";
        await (prisma as any).supplyRequest.create({ data: { outlet, productKey, qty, status: "pending", source: "webhook", requestedBy: phone } });
        const suppliers = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier" } });
        const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });
        const notice = `📦 Supply request: ${outlet} needs ${qty} ${productKey}.`;
        await Promise.all([
          ...suppliers.map((s: any) => sendWaText(s.phoneE164, notice)),
          ...supervisors.map((s: any) => sendWaText(s.phoneE164, notice)),
        ]);
        if (phone) await sendWaText(phone, `✅ Request received for ${qty} ${productKey}.`);
        break;
      }
      case "deposit_confirmed": {
        if (phone) await sendWaText(phone, `✅ Deposit confirmed. Thank you.`);
        break;
      }
      default: {
        if (phone) await sendWaText(phone, `👋 Received tag: ${tag}.`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

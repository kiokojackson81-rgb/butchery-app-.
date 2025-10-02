import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import crypto from "crypto";
import { sendTemplate, sendText } from "@/lib/wa";
import {
  sendClosingStockSubmitted,
  sendLowStockAlert,
  sendSupplyReceived,
  sendSupplyRequest,
  sendWasteRejected,
} from "@/lib/wa-send-presets";
import { prisma } from "@/lib/prisma";

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
        if (phone) {
          await sendTemplate({ to: phone, template: "generic_alert", params: [`✅ Closing submitted. Deposit recorded: Ksh ${amount || 0}.`] });
        }
        // approved template (non-breaking addition)
        try {
          const outlet = String(payload?.outlet || payload?.data?.outlet || "");
          const summary = String(payload?.summary || payload?.summaryLine || payload?.totals || "");
          if (phone && (outlet || summary)) {
            await sendClosingStockSubmitted(phone, outlet, summary);
          }
        } catch {}
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
          ...suppliers.map((s: any) => sendTemplate({ to: s.phoneE164, template: "generic_alert", params: [msg] })),
          ...supervisors.map((s: any) => sendTemplate({ to: s.phoneE164, template: "generic_alert", params: [msg] })),
        ]);
        if (phone) await sendTemplate({ to: phone, template: "generic_alert", params: ["✅ Notified supplier & supervisor."] });
        // approved template (non-breaking addition)
        try {
          const item = String(payload?.item || payload?.product || payload?.productKey || "");
          const qtyStr = String(payload?.qty ?? payload?.quantity ?? "");
          if (phone && (item || qtyStr)) {
            await sendLowStockAlert(phone, item, qtyStr);
          }
        } catch {}
        break;
      }
      case "supply_request": {
        const text = String(payload?.text || payload?.message || "");
        const m = /^request\s+([a-zA-Z0-9_-]+)\s+([0-9]+(\.[0-9]+)?)$/i.exec(text.trim());
        if (!m) {
          if (phone) await sendTemplate({ to: phone, template: "generic_alert", params: ["Hi! Use: request <itemKey> <qty>. Example: request beef 20"] });
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
          ...suppliers.map((s: any) => sendTemplate({ to: s.phoneE164, template: "generic_alert", params: [notice] })),
          ...supervisors.map((s: any) => sendTemplate({ to: s.phoneE164, template: "generic_alert", params: [notice] })),
        ]);
        if (phone) {
          const msg = `✅ Request received for ${qty} ${productKey}.`;
          await sendTemplate({ to: phone, template: "generic_alert", params: [msg] });
        }
        // approved template (non-breaking addition)
        try {
          const listLine = String(payload?.listLine || payload?.list || payload?.note || payload?.items || `${qty} ${productKey}`);
          if (phone) {
            await sendSupplyRequest(phone, outlet, listLine);
          }
        } catch {}
        break;
      }
      case "deposit_confirmed": {
        if (phone) await sendTemplate({ to: phone, template: "generic_alert", params: ["✅ Deposit confirmed. Thank you."] });
        break;
      }
      case "supply_received": {
        // approved template only if enough context present
        try {
          const outlet = String(payload?.outlet || payload?.data?.outlet || "");
          const grn = String(payload?.grn || payload?.grnNo || payload?.note || "");
          if (phone && (outlet || grn)) {
            await sendSupplyReceived(phone, outlet, grn);
          }
        } catch {}
        break;
      }
      case "waste_rejected": {
        try {
          const reason = String(payload?.reason || payload?.note || payload?.message || "");
          if (phone && reason) {
            await sendWasteRejected(phone, reason);
          }
        } catch {}
        break;
      }
      default: {
        if (phone) {
          const msg = `👋 Received tag: ${tag}.`;
          await sendTemplate({ to: phone, template: "generic_alert", params: [msg] });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

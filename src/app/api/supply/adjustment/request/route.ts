import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/lib/wa_phone";

// POST /api/supply/adjustment/request
// Body: { date, outlet, itemKey, currentQty?, newQty, reason, requestedBy? }
// Creates a ReviewItem(type='supply_adjustment', status='pending') and notifies via WhatsApp.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const date = String(body?.date || "").slice(0, 10);
    const outlet = String(body?.outlet || "").trim();
    const itemKey = String(body?.itemKey || "").trim();
    const newQty = Number(body?.newQty || 0);
    const currentQty = Number(body?.currentQty || 0);
    const reason = String(body?.reason || "").trim();
    const requestedBy = String(body?.requestedBy || "supplier").trim();

    if (!date || !outlet || !itemKey || !(newQty > 0) || !reason) {
      return NextResponse.json({ ok: false, error: "missing/invalid fields" }, { status: 400 });
    }

    const payload = { itemKey, currentQty, newQty, reason, requestedBy };
    const review = await (prisma as any).reviewItem.create({
      data: { type: "supply_adjustment", outlet, date: new Date(date), payload, status: "pending" },
    });

    // WhatsApp notifications (best-effort): attendant(s) at outlet + supervisors
    try {
      const attendants = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet } });
      const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });
      const admins = await (prisma as any).phoneMapping.findMany({ where: { role: "admin" } });
      const item = itemKey.toUpperCase();
      const msgA = `Supplier requested adjustment: ${item} from ${currentQty} to ${newQty} at ${outlet}. Reason: ${reason}`;
      const msgS = `Adjustment request pending: ${item} ${outlet} ${date}. ${currentQty} → ${newQty}. Reason: ${reason}`;
      await Promise.allSettled([
        ...attendants.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgA })),
        ...supervisors.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgS })),
        ...admins.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgS })),
      ]);
    } catch {}

    return NextResponse.json({ ok: true, review });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

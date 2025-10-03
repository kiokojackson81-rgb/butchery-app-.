import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { toGraphPhone } from "@/lib/wa_phone";

// POST /api/supervisor/closing/update
// Body: { date, outlet, itemKey, closingQty?, wasteQty?, reason }
// Upserts AttendantClosing and creates a ReviewItem(type='closing_adjustment').
// Notifies attendants for outlet, supervisors and admins via WhatsApp.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const date = String(body?.date || "").slice(0, 10);
    const outlet = String(body?.outlet || "").trim();
    const itemKey = String(body?.itemKey || "").trim();
    const closingQty = body?.closingQty == null ? null : Math.max(0, Number(body?.closingQty || 0));
    const wasteQty = body?.wasteQty == null ? null : Math.max(0, Number(body?.wasteQty || 0));
    const reason = String(body?.reason || "").trim();
    if (!date || !outlet || !itemKey) return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });

    const row = await (prisma as any).attendantClosing.upsert({
      where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } },
      update: {
        ...(closingQty != null ? { closingQty } : {}),
        ...(wasteQty != null ? { wasteQty } : {}),
      },
      create: {
        date,
        outletName: outlet,
        itemKey,
        closingQty: closingQty ?? 0,
        wasteQty: wasteQty ?? 0,
      },
    });

    // Log review item for audit
    await (prisma as any).reviewItem.create({
      data: {
        type: "closing_adjustment",
        outlet,
        date: new Date(date),
        payload: { itemKey, closingQty, wasteQty, reason },
        status: "approved", // supervisor made the change directly
      },
    });

    // WhatsApp notifications (best-effort)
    try {
      const attendants = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet } });
      const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });
      const admins = await (prisma as any).phoneMapping.findMany({ where: { role: "admin" } });
      const changed = [
        closingQty != null ? `closing=${closingQty}` : null,
        wasteQty != null ? `waste=${wasteQty}` : null,
      ].filter(Boolean).join(", ");
      const msg = `Closing updated: ${itemKey} at ${outlet} (${date}) — ${changed}. ${reason ? "Reason: " + reason : ""}`.trim();
      await Promise.allSettled([
        ...attendants.map((m: any) => m?.phoneE164 && sendText(toGraphPhone(m.phoneE164), msg)),
        ...supervisors.map((m: any) => m?.phoneE164 && sendText(toGraphPhone(m.phoneE164), msg)),
        ...admins.map((m: any) => m?.phoneE164 && sendText(toGraphPhone(m.phoneE164), msg)),
      ]);
    } catch {}

    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

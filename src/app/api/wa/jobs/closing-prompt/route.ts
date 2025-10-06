import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendInteractive, logOutbound, sendText } from "@/lib/wa";
import { menuMain } from "@/lib/wa_messages";
import { sendOpsMessage } from "@/lib/wa_dispatcher";

export async function GET() {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const attendants = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant" } });
    for (const a of attendants) {
      const phone = String(a.phoneE164 || "");
      if (!/^\+?254\d{9,10}$/.test(phone)) continue; // simple normalization gate
      await (prisma as any).waSession.upsert({
        where: { phoneE164: phone.startsWith("+") ? phone : "+" + phone },
        create: { phoneE164: phone.startsWith("+") ? phone : "+" + phone, role: "attendant", code: a.code, outlet: a.outlet || null, state: "MENU", cursor: { date, rows: [] } },
        update: { code: a.code, outlet: a.outlet || null, state: "MENU", cursor: { date, rows: [] } },
      });
      if (process.env.WA_AUTOSEND_ENABLED === "true") {
        // old path (temporary)
        try {
          const body = await menuMain(phone, a.outlet || undefined);
          const res = await sendInteractive(body);
          await logOutbound({ direction: "out", templateName: null, payload: { request: body, response: res }, waMessageId: (res as any)?.waMessageId ?? null, status: (res as any)?.ok ? "SENT" : "ERROR" });
        } catch (err) {
          await logOutbound({ direction: "out", templateName: null, payload: { error: String((err as any)?.message || err) }, status: "ERROR" });
          try { await sendText(phone, `${a.outlet || "Outlet"} — closing stock.\nReply MENU to start.`); } catch {}
        }
      } else {
        // new dispatcher path
        try { await sendOpsMessage(phone, { kind: "closing_reminder", outlet: a.outlet || "Outlet" }); } catch {}
      }
    }
    return NextResponse.json({ ok: true, count: attendants.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) });
  }
}

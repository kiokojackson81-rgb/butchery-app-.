import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";
import { sendTemplate, sendInteractive } from "@/lib/wa";
import { buildProductList } from "@/lib/wa_messages";

export async function GET() {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const attendants = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant" } });
    for (const a of attendants) {
      await (prisma as any).waSession.upsert({
        where: { phoneE164: a.phoneE164 },
        create: { phoneE164: a.phoneE164, role: "attendant", code: a.code, outlet: a.outlet || null, state: "MENU", cursor: { date, rows: [] } },
        update: { code: a.code, outlet: a.outlet || null, state: "MENU", cursor: { date, rows: [] } },
      });
      try {
        await sendTemplate({ to: a.phoneE164, template: "closing_prompt", params: [a.code, a.outlet || "", date] });
      } catch {}
      // Optional: interactive list could be sent after template; needs products by assignment
      // If you have AttendantScope, fetch and build list here.
    }
    return NextResponse.json({ ok: true, count: attendants.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) });
  }
}

import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";
import { sendInteractive, logOutbound } from "@/lib/wa";
import { buildProductList } from "@/lib/wa_messages";
import { getAssignedProducts } from "@/lib/wa_attendant_flow";

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
        const products = await getAssignedProducts(String(a.code || ""));
        const body = buildProductList(a.phoneE164, products);
        const res = await sendInteractive(body);
        await logOutbound({ direction: "out", templateName: null, payload: { request: body, response: res }, waMessageId: (res as any)?.waMessageId ?? null, status: (res as any)?.ok ? "SENT" : "ERROR" });
      } catch (err) {
        await logOutbound({ direction: "out", templateName: null, payload: { error: String((err as any)?.message || err) }, status: "ERROR" });
      }
    }
    return NextResponse.json({ ok: true, count: attendants.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) });
  }
}

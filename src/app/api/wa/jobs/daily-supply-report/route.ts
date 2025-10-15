export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toGraphPhone } from "@/lib/wa_phone";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { buildDailyItems, formatDailyReportSupplier, formatDailyReportOps } from "@/lib/wa_supply_daily_report";

function todayKeyEAT() {
  // Nairobi local date (YYYY-MM-DD)
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now).reduce((acc: any, p) => (acc[p.type] = p.value, acc), {} as any);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET() {
  try {
    const dateKey = todayKeyEAT();
    const now = new Date();
    const outlets: any[] = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
    for (const o of outlets) {
      const outletName = o.name as string;
      const items = await buildDailyItems(outletName, dateKey);
      if (!items.length) continue;

      // Resolve attendant and supplier names best-effort
      const attendantMap = await (prisma as any).phoneMapping.findFirst({ where: { role: "attendant", outlet: outletName } }).catch(() => null);
      const attendantName = attendantMap?.code || undefined;
      const supplierMap = await (prisma as any).phoneMapping.findFirst({ where: { role: "supplier", outlet: outletName } }).catch(() => null);
      const supplierName = supplierMap?.code || undefined; // We show name or fallback inside formatter

      // Send to suppliers (omit selling/expected/margin)
      const suppliers = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier", outlet: outletName } });
      if (suppliers?.length) {
        const text = formatDailyReportSupplier({ outletName, date: now, attendantName, supplierName, items });
        for (const s of suppliers) {
          if (!s.phoneE164) continue;
          await sendOpsMessage(toGraphPhone(s.phoneE164), { kind: "free_text", text });
        }
      }

      // Send to admins and supervisors (full details)
      const ops = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ["admin", "supervisor"] as any }, outlet: outletName } });
      if (ops?.length) {
        const text = formatDailyReportOps({ outletName, date: now, attendantName, supplierName, items });
        for (const r of ops) {
          if (!r.phoneE164) continue;
          await sendOpsMessage(toGraphPhone(r.phoneE164), { kind: "free_text", text });
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

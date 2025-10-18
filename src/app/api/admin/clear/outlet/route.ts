import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { APP_TZ, addDaysISO, dateISOInTZ } from "@/server/trading_period";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Scope = "today" | "yesterday" | "everything" | "date";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const outletId = typeof body?.outletId === "string" ? body.outletId : "";
    const outletNameRaw = typeof body?.outletName === "string" ? body.outletName : "";
    const scope: Scope = (body?.scope === "yesterday" || body?.scope === "everything" || body?.scope === "date") ? body.scope : "today";
    const dateParam = typeof body?.date === "string" ? body.date.slice(0, 10) : ""; // for scope=date
    const preventCarryForward: boolean = !!body?.preventCarryForward; // when clearing today, also clear yesterday closings
    const resetActivePeriod: boolean = body?.resetActivePeriod !== false; // default true

    if (!outletId && !outletNameRaw) {
      return NextResponse.json({ ok: false, error: "missing outletId or outletName" }, { status: 400 });
    }

    // Resolve outlet
    let outlet: any = null;
    if (outletId) outlet = await (prisma as any).outlet.findUnique({ where: { id: outletId } }).catch(() => null);
    if (!outlet && outletNameRaw) outlet = await (prisma as any).outlet.findFirst({ where: { name: outletNameRaw } }).catch(() => null);
    if (!outlet) return NextResponse.json({ ok: false, error: "outlet not found" }, { status: 404 });
    const outletName = String(outlet.name);

    const tz = APP_TZ;
    const today = dateISOInTZ(new Date(), tz);
    const yesterday = addDaysISO(today, -1, tz);
    const targetDate = scope === "today" ? today : scope === "yesterday" ? yesterday : (scope === "date" && dateParam ? dateParam : "");

    const results: Record<string, number> = {};
    async function del(model: string, where: any, key: string) {
      try { const r = await (prisma as any)[model].deleteMany({ where }); results[key] = (results[key] || 0) + Number(r?.count || 0); } catch { results[key] = (results[key] || 0); }
    }

    if (scope === "everything") {
      // Full history clear for this outlet (no deactivation)
      await del("supplyOpeningRow", { outletName }, "supplyOpening");
      await del("attendantClosing", { outletName }, "closings");
      await del("attendantExpense", { outletName }, "expenses");
      await del("attendantDeposit", { outletName }, "deposits");
      await del("attendantTillCount", { outletName }, "till");
      // active period
      try { const r = await (prisma as any).activePeriod.deleteMany({ where: { outletName } }); results["activePeriod"] = Number(r?.count || 0); } catch { results["activePeriod"] = 0; }
      // delete Settings keys that include this outletName (locks, close counts, snapshots)
      try { const r = await (prisma as any).setting.deleteMany({ where: { key: { contains: `:${outletName}` } } }); results["settings"] = Number(r?.count || 0); } catch { results["settings"] = 0; }
    } else {
      if (!targetDate) return NextResponse.json({ ok: false, error: "target date missing" }, { status: 400 });
      // Day-specific clear
      await del("supplyOpeningRow", { outletName, date: targetDate }, "supplyOpening");
      await del("attendantClosing", { outletName, date: targetDate }, "closings");
      await del("attendantExpense", { outletName, date: targetDate }, "expenses");
      await del("attendantDeposit", { outletName, date: targetDate }, "deposits");
      await del("attendantTillCount", { outletName, date: targetDate }, "till");
      // Remove per-day settings: lock, closecount, snapshots
      try { const r = await (prisma as any).setting.deleteMany({ where: { key: { in: [
        `lock:attendant:${targetDate}:${outletName}`,
        `period:closecount:${targetDate}:${outletName}`,
      ] } } }); results["settings"] = Number(r?.count || 0); } catch { results["settings"] = 0; }
      // Remove snapshot keys for that date
      try { const r = await (prisma as any).setting.deleteMany({ where: { key: { contains: `snapshot:closing:${targetDate}:${outletName}` } } }); results["snapshots"] = Number(r?.count || 0); } catch { results["snapshots"] = 0; }

      // Optionally prevent carry-forward: also clear yesterday's closings so OpeningEff won't pick them
      if (preventCarryForward) {
        const prev = addDaysISO(targetDate, -1, tz);
        await del("attendantClosing", { outletName, date: prev }, "prevClosings");
        try { const r = await (prisma as any).setting.deleteMany({ where: { key: { in: [
          `period:closecount:${prev}:${outletName}`,
          `lock:attendant:${prev}:${outletName}`,
        ] } } }); results["prevSettings"] = Number(r?.count || 0); } catch { results["prevSettings"] = 0; }
        try { const r = await (prisma as any).setting.deleteMany({ where: { key: { contains: `snapshot:closing:${prev}:${outletName}` } } }); results["prevSnapshots"] = Number(r?.count || 0); } catch { results["prevSnapshots"] = 0; }
      }

      if (resetActivePeriod) {
        try { const r = await (prisma as any).activePeriod.deleteMany({ where: { outletName } }); results["activePeriod"] = Number(r?.count || 0); } catch { results["activePeriod"] = 0; }
      }
    }

    // Log admin clear event
    try {
      const key = `admin_clear:${Date.now()}:${outletName}:${scope}`;
      const value: any = { type: "admin_clear", outlet: outletName, scope, date: targetDate || null, preventCarryForward, resetActivePeriod, at: new Date().toISOString(), counts: results };
      await (prisma as any).setting.create({ data: { key, value } });
    } catch {}

    return NextResponse.json({ ok: true, outletName, scope, date: targetDate || null, deleted: results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

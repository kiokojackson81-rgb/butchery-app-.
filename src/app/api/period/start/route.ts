import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCloseCount, incrementCloseCount, APP_TZ, addDaysISO, dateISOInTZ } from "@/server/trading_period";

export async function POST(req: Request) {
  try {
    const { outlet, openingSnapshot, pricebookSnapshot } = (await req.json()) as {
      outlet: string;
      openingSnapshot: Record<string, number>;
      pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }>;
    };
    if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const tz = APP_TZ;
    const date = dateISOInTZ(new Date(), tz);
    const tomorrow = addDaysISO(date, 1, tz);

    // Allow third+ submissions without rotation. We only rotate on first (→ today) and second (→ tomorrow).
    const currentCount = await getCloseCount(outlet, date).catch(() => 0);
  let nextCount = currentCount;
  let rotated = false;
  // Extra diagnostics to help clients auto-refresh without reload
  let clearedClosingsCount = 0;
  let clearedExpensesCount = 0;
  let seededTodayCount = 0;
  let seededTomorrowCount = 0;
  let seededTodayKeys: string[] = [];
  let seededTomorrowKeys: string[] = [];
  let phase: "none" | "first" | "second" = "none";
  let pricebookUpserts = 0;
    if (currentCount < 2) {
      nextCount = await incrementCloseCount(outlet, date).catch(() => currentCount + 1);
    }

  await prisma.$transaction(async (tx) => {
      // Rotation rules (supply resets across periods):
      // - First close (mid-day): reset TODAY's opening rows equal to today's CLOSING if any; otherwise use only previous day's CLOSING.
      //   Clear today's closings and expenses. Snapshot this reset for audit.
      // - Second close (EOD): seed TOMORROW's opening rows equal to today's CLOSING if any; otherwise use only previous day's CLOSING.
    try {
      // Build prevOpen from yesterday's closing
  const y = addDaysISO(date, -1, tz);
      const [prevClosings, todaySupplyRows, todaysClosings, todaysExpenses, productRows] = await Promise.all([
        (tx as any).attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
        (tx as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
        (tx as any).attendantClosing.findMany({ where: { date, outletName: outlet } }),
        (tx as any).attendantExpense.findMany({ where: { date, outletName: outlet } }),
        (tx as any).product.findMany({ select: { key: true, unit: true } }),
      ]);

      const prevOpenByItem: Record<string, number> = {};
      for (const r of prevClosings || []) {
        const k = String((r as any).itemKey);
        const qty = Number((r as any).closingQty || 0);
        if (!Number.isFinite(qty)) continue;
        prevOpenByItem[k] = (prevOpenByItem[k] || 0) + qty;
      }

      const supplyByItem: Record<string, number> = {};
      for (const r of todaySupplyRows || []) {
        const k = String((r as any).itemKey);
        const qty = Number((r as any).qty || 0);
        if (!Number.isFinite(qty)) continue;
        supplyByItem[k] = (supplyByItem[k] || 0) + qty;
      }

      const closingByItem: Record<string, { closingQty: number; wasteQty: number }> = {};
      for (const r of todaysClosings || []) {
        const k = String((r as any).itemKey);
        closingByItem[k] = {
          closingQty: Number((r as any).closingQty || 0),
          wasteQty: Number((r as any).wasteQty || 0),
        };
      }

      // Period rotation behavior:
      // - After first close of the day (nextCount === 1): set TODAY's opening rows = today's closing if present, else previous closing only.
      //   Expenses are cleared; this starts a new in-day period with supply reset relative to the new base.
      // - After second close (nextCount >= 2): seed TOMORROW's opening rows similarly (today's closing if present, else previous closing only).
      const keys = new Set<string>([
        ...Object.keys(prevOpenByItem),
        ...Object.keys(supplyByItem),
        ...Object.keys(closingByItem),
      ]);
      if (nextCount === 1) {
        const unitByKey: Record<string, string> = {};
        for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";
        // Snapshot this in-day close (period reset) before we clear rows, for audit/tracking
        try {
          const snapKey = `snapshot:closing:${date}:${outlet}:1`;
          const snapshot = {
            type: "period_reset_snapshot",
            outlet,
            date,
            closeIndex: 1,
            createdAt: new Date().toISOString(),
            closings: (todaysClosings || []).map((r: any) => ({ itemKey: r.itemKey, closingQty: r.closingQty, wasteQty: r.wasteQty })),
            expenses: (todaysExpenses || []).map((e: any) => ({ name: e.name, amount: e.amount })),
          } as any;
          await (tx as any).setting.upsert({ where: { key: snapKey }, update: { value: snapshot }, create: { key: snapKey, value: snapshot } });
        } catch {}
        // Reset today's opening rows to the new base.
        // If there are closing rows today, carry forward CLOSING.
        // If there are NO closing rows today, use only prevClosing (supply resets for the new period).
        await (tx as any).supplyOpeningRow.deleteMany({ where: { date, outletName: outlet } });
        const hasClosings = (todaysClosings?.length || 0) > 0;
        const dataToday: Array<{ date: string; outletName: string; itemKey: string; qty: number; unit: string }> = [];
        for (const key of keys) {
          const baseQty = hasClosings
            ? Number((closingByItem[key]?.closingQty) || 0)
            : Number((prevOpenByItem[key] || 0));
          const nextQty = Math.max(0, baseQty);
          if (nextQty > 0) dataToday.push({ date, outletName: outlet, itemKey: key, qty: nextQty, unit: unitByKey[key] || "kg" });
        }
        if (dataToday.length > 0) {
          await (tx as any).supplyOpeningRow.createMany({ data: dataToday });
          seededTodayCount = dataToday.length;
          seededTodayKeys = dataToday.map((r) => r.itemKey);
        }
        // Important: start a clean in-day period by clearing any saved closings for today.
        // We already used today's closings above to compute the new base; now wipe them so the
        // dashboard won't re-overlay/lock rows as "Submitted" after reload.
        try {
          const res = await (tx as any).attendantClosing.deleteMany({ where: { date, outletName: outlet } });
          clearedClosingsCount = Number((res as any)?.count || 0);
        } catch {}

        // Reset expenses for the new in-day period (do not carry forward)
        try {
          const res = await (tx as any).attendantExpense.deleteMany({ where: { date, outletName: outlet } });
          clearedExpensesCount = Number((res as any)?.count || 0);
        } catch {}
        rotated = true;
        phase = "first";
      } else if (nextCount >= 2) {
        if (currentCount === 1) {
          const unitByKey: Record<string, string> = {};
          for (const p of productRows || []) unitByKey[(p as any).key] = (p as any).unit || "kg";
          // This call bumped from 1 → 2: seed tomorrow and mark rotated
          await (tx as any).supplyOpeningRow.deleteMany({ where: { date: tomorrow, outletName: outlet } });
          const hasClosings = (todaysClosings?.length || 0) > 0;
          const dataTomorrow: Array<{ date: string; outletName: string; itemKey: string; qty: number; unit: string }> = [];
          for (const key of keys) {
            // If there are closing rows today, carry forward CLOSING.
            // If not, seed tomorrow from prevClosing only (supply resets for the new period).
            const baseQty = hasClosings
              ? Number((closingByItem[key]?.closingQty) || 0)
              : Number((prevOpenByItem[key] || 0));
            const nextQty = Math.max(0, baseQty);
            if (nextQty > 0) dataTomorrow.push({ date: tomorrow, outletName: outlet, itemKey: key, qty: nextQty, unit: unitByKey[key] || "kg" });
          }
          if (dataTomorrow.length > 0) {
            await (tx as any).supplyOpeningRow.createMany({ data: dataTomorrow });
            seededTomorrowCount = dataTomorrow.length;
            seededTomorrowKeys = dataTomorrow.map((r) => r.itemKey);
          }
          rotated = true;
          phase = "second";
        } else {
          // Third+ submission in same day: no rotation.
          rotated = false;
          phase = "none";
        }
      }
      } catch {}

      // Upsert pricebook snapshot
      for (const [itemKey, row] of Object.entries(pricebookSnapshot || {})) {
        await tx.pricebookRow.upsert({
          where: { outletName_productKey: { outletName: outlet, productKey: itemKey } },
          create: { outletName: outlet, productKey: itemKey, sellPrice: Number((row as any).sellPrice || 0), active: !!(row as any).active },
          update: { sellPrice: Number((row as any).sellPrice || 0), active: !!(row as any).active },
        });
        pricebookUpserts++;
      }

      // Active period
      await tx.activePeriod.upsert({
        where: { outletName: outlet },
        create: { outletName: outlet, periodStartAt: new Date() },
        update: { periodStartAt: new Date() },
      });
    });

    // No calendar-day locking: multiple periods allowed per day (max 2). Return current close count plus details.
    return NextResponse.json({
      ok: true,
      date,
      tomorrow,
      closeCount: nextCount,
      rotated,
      details: {
        seededTodayCount,
        seededTomorrowCount,
        clearedClosingsCount,
        clearedExpensesCount,
        seededTodayKeys,
        seededTomorrowKeys,
        phase,
        pricebookUpserts,
      },
    });
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : "period/start failed";
    return NextResponse.json({ ok: false, error: msg });
  }
}

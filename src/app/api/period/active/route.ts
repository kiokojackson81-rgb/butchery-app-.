import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  if (!outlet) return NextResponse.json({ ok: true, active: null });

  // Lazy auto-rotation logic:
  // - If a new calendar day has started and no manual rotation was done, start a new period at midnight.
  // - If more than 48 hours have elapsed without a submit/rotation, force-start a new period.
  // - If no closings were recorded yesterday, carry forward yesterday's opening rows as today's opening.
  const today = new Date().toISOString().slice(0, 10);
  const todayMidnight = new Date(`${today}T00:00:00.000Z`);

  let active = await prisma.activePeriod.findUnique({ where: { outletName: outlet } });

  const needCreate = !active;
  const startedAt = active?.periodStartAt ? new Date(active.periodStartAt) : null;
  const dayOfStart = startedAt ? startedAt.toISOString().slice(0, 10) : null;
  const hoursSinceStart = startedAt ? (Date.now() - startedAt.getTime()) / 36e5 : Infinity;
  const dayChanged = !dayOfStart || dayOfStart !== today;
  const over48h = hoursSinceStart >= 48;

  // Decide whether to auto-rotate now
  let shouldRotateNow = false;
  if (needCreate || over48h) {
    shouldRotateNow = true;
  } else if (dayChanged) {
    // Auto-rotate at midnight only if yesterday had no closings (attendant did NOT start a new period manually)
    try {
      const dt = new Date(`${today}T00:00:00.000Z`); dt.setUTCDate(dt.getUTCDate() - 1);
      const y = dt.toISOString().slice(0, 10);
      const yClosings = await prisma.attendantClosing.findMany({ where: { date: y, outletName: outlet } });
      if ((yClosings?.length || 0) === 0) shouldRotateNow = true;
    } catch {}
  }

  if (shouldRotateNow) {
    // If rotating due to midnight default (no closings) or 48h timeout, and there were no closings yesterday,
    // carry forward yesterday's opening rows to today so attendants have opening stock.
    try {
      const dt = new Date(`${today}T00:00:00.000Z`); dt.setUTCDate(dt.getUTCDate() - 1);
      const y = dt.toISOString().slice(0, 10);
      const [yClosings, yOpenings] = await Promise.all([
        prisma.attendantClosing.findMany({ where: { date: y, outletName: outlet } }),
        prisma.supplyOpeningRow.findMany({ where: { date: y, outletName: outlet } }),
      ]);
      if ((yClosings?.length || 0) === 0 && (yOpenings?.length || 0) > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.supplyOpeningRow.deleteMany({ where: { date: today, outletName: outlet } });
          await tx.supplyOpeningRow.createMany({
            data: (yOpenings || []).map((r: any) => ({
              date: today,
              outletName: outlet,
              itemKey: r.itemKey,
              qty: Number(r.qty || 0),
              unit: (r as any).unit || undefined,
              buyPrice: (r as any).buyPrice || undefined,
            })),
          });
        });
      }
    } catch {}

    // Upsert ActivePeriod for the new day (default start at midnight for determinism)
    active = await prisma.activePeriod.upsert({
      where: { outletName: outlet },
      create: { outletName: outlet, periodStartAt: todayMidnight },
      update: { periodStartAt: todayMidnight },
    });
  }

  return NextResponse.json({ ok: true, active: { periodStartAt: active?.periodStartAt || todayMidnight } });
}

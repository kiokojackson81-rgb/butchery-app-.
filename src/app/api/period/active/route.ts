import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import logger from '@/lib/logger';
import { lockPeriod, APP_TZ, dateISOInTZ, addDaysISO } from "@/server/trading_period";

function fail(msg: string, code = 500) { return NextResponse.json({ ok: false, error: msg }, { status: code }); }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  if (!outlet) return NextResponse.json({ ok: true, active: null });

  try {
  // Lazy auto-rotation logic:
  // - Always ensure an ActivePeriod row exists for the outlet (starts "immediately").
  // - If a new calendar day has started and there was NO attendant activity yesterday,
  //   then auto-close yesterday and start a new period at midnight.
  // - If ~48 hours have elapsed without any attendant activity, force-start a new period.
  // - When auto-rotating due to "no-activity yesterday", carry forward yesterday's opening rows.
  const tz = APP_TZ;
  const today = dateISOInTZ(new Date(), tz);
  // For Nairobi (no DST), we can safely use +03:00 for a stable midnight instance
  const fixedOffset = tz === "Africa/Nairobi" ? "+03:00" : "+00:00";
  const todayMidnight = new Date(`${today}T00:00:00${fixedOffset}`);

  let active = await prisma.activePeriod.findUnique({ where: { outletName: outlet } });

  const needCreate = !active;
  const startedAt = active?.periodStartAt ? new Date(active.periodStartAt) : null;
  const dayOfStart = startedAt ? dateISOInTZ(startedAt, tz) : null;
  const dayChanged = !dayOfStart || dayOfStart !== today;

  // Helper: detect if there was any activity for a given outlet/date
  async function hasActivity(date: string): Promise<boolean> {
    const [c1, c2, c3, c4, c5] = await Promise.all([
      prisma.attendantClosing.count({ where: { outletName: outlet, date } }).catch(() => 0),
      prisma.attendantExpense.count({ where: { outletName: outlet, date } }).catch(() => 0),
      prisma.attendantDeposit.count({ where: { outletName: outlet, date } }).catch(() => 0),
      prisma.supplyOpeningRow.count({ where: { outletName: outlet, date } }).catch(() => 0),
      prisma.attendantTillCount.count({ where: { outletName: outlet, date } }).catch(() => 0),
    ]);
    return (c1 + c2 + c3 + c4 + c5) > 0;
  }

  // Helper: latest activity date (YYYY-MM-DD) across supported tables
  async function getLastActivityDate(): Promise<string | null> {
    const [d1, d2, d3, d4, d5] = await Promise.all([
      prisma.attendantClosing.findFirst({ where: { outletName: outlet }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
      prisma.attendantExpense.findFirst({ where: { outletName: outlet }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
      prisma.attendantDeposit.findFirst({ where: { outletName: outlet }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
      prisma.supplyOpeningRow.findFirst({ where: { outletName: outlet }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
      prisma.attendantTillCount.findFirst({ where: { outletName: outlet }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    ]);
    const dates = [d1?.date, d2?.date, d3?.date, d4?.date, d5?.date].filter(Boolean) as string[];
    if (dates.length === 0) return null;
    return dates.sort().slice(-1)[0];
  }

  // Compute ~48h inactivity based on last activity date (coarse by days)
  const lastActivity = await getLastActivityDate();
  let over48h = false;
  if (lastActivity) {
    // Compare as calendar days in TZ
    const days = ((): number => {
      // Convert both to tz-anchored midnights
      const dLast = new Date(`${lastActivity}T00:00:00${fixedOffset}`).getTime();
      const dToday = new Date(`${today}T00:00:00${fixedOffset}`).getTime();
      return Math.floor((dToday - dLast) / (24 * 3600 * 1000));
    })();
    over48h = days >= 2; // no activity for at least 2 full days
  }

  // Determine whether yesterday had any activity
  const y = addDaysISO(today, -1, tz);
  let anyActivityYesterday = false;
  try { anyActivityYesterday = await hasActivity(y); } catch {}

  // Decide whether to auto-rotate now
  let shouldRotateNow = false;
  if (needCreate || over48h) {
    shouldRotateNow = true;
  } else if (dayChanged) {
    // Auto-rotate at midnight only if there was NO attendant activity yesterday
    if (!anyActivityYesterday) shouldRotateNow = true;
  }

  if (shouldRotateNow) {
    // If rotating because there was no activity yesterday, lock that day and carry forward openings
    if (!anyActivityYesterday) {
      try { await lockPeriod(outlet, y, "system"); } catch {}
      try {
        const [yOpenings] = await Promise.all([
          prisma.supplyOpeningRow.findMany({ where: { date: y, outletName: outlet } }),
        ]);
        if ((yOpenings?.length || 0) > 0) {
          await prisma.$transaction(async (tx) => {
            await tx.supplyOpeningRow.deleteMany({ where: { date: today, outletName: outlet } });
              try {
                await tx.supplyOpeningRow.createMany({
                  data: (yOpenings || []).map((r: any) => ({
                    date: today,
                    outletName: outlet,
                    itemKey: r.itemKey,
                    qty: Number(r.qty || 0),
                    unit: (r as any).unit || undefined,
                    buyPrice: (r as any).buyPrice || undefined,
                  })),
                  skipDuplicates: true,
                });
              } catch {}
          });
        }
      } catch {}
    }

    // Upsert ActivePeriod for the new day (default start at midnight for determinism)
    active = await prisma.activePeriod.upsert({
      where: { outletName: outlet },
      create: { outletName: outlet, periodStartAt: todayMidnight },
      update: { periodStartAt: todayMidnight },
    });
  }

  return NextResponse.json({ ok: true, active: { periodStartAt: active?.periodStartAt || todayMidnight } });
  } catch (e: any) {
    // Handle missing table (Prisma P2021) gracefully and give actionable message
    const code = e?.code || (e?.name === 'PrismaClientKnownRequestError' ? 'P2021' : undefined);
    logger.error({ ts: new Date().toISOString(), level: 'error', action: 'period:active:error', error: String(e), code });
    if (code === 'P2021') {
      return fail('Database table ActivePeriod does not exist. Run Prisma migrations (prisma migrate deploy) or prisma db push.', 500);
    }
    return fail('internal error', 500);
  }
}

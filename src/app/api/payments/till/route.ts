import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { APP_TZ, dateISOInTZ } from "@/server/trading_period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // Parse query
    const url = new URL(req.url);
    const outletParam = url.searchParams.get("outlet");
    const byParam = (url.searchParams.get("by") || "outlet").toLowerCase(); // 'outlet' | 'till'
    const codeParam = (url.searchParams.get("code") || "").trim();           // till number when by=till
    const inclusive = (url.searchParams.get("inclusive") || "false").toLowerCase() === "true";
    // Prefer explicit session.outletCode unless a valid-looking outlet query param is provided.
  const rawOutlet = outletParam || (sess as any).outletCode || (sess as any).attendant?.outletRef?.code || (sess as any).attendant?.outletRef?.name;
  // For outlet mode, require an outlet binding; for till mode, allow missing outlet
  if (byParam !== "till" && !rawOutlet) return NextResponse.json({ ok: false, error: "no_outlet_bound" }, { status: 400 });

    // Normalize to Prisma enum OutletCode expected by Payment/Till
    const allowed = ["BRIGHT", "BARAKA_A", "BARAKA_B", "BARAKA_C", "GENERAL"] as const;
    const toEnum = (s: string | null | undefined) => {
      if (!s) return null;
      const c = String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      return (allowed as readonly string[]).includes(c) ? (c as typeof allowed[number]) : null;
    };
    // Try direct normalization; if that fails and we have an Outlet.name-like value (e.g., "Baraka A"), normalize again
  let outletEnum = toEnum(rawOutlet);
    if (!outletEnum) {
      // Some sessions store lowercase codes like "bright"; also handle common aliases
      const aliases: Record<string, string> = {
        BRIGHT: "BRIGHT",
        BARAKA: "BARAKA_A", // fallback to A when unspecified
        BARAKA_A: "BARAKA_A",
        BARAKA_B: "BARAKA_B",
        BARAKA_C: "BARAKA_C",
        GENERAL: "GENERAL",
      };
      const c = String(rawOutlet).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      if (aliases[c]) outletEnum = aliases[c] as any;
    }
    if (byParam !== "till" && !outletEnum) {
      return NextResponse.json({ ok: false, error: `unknown_outlet_code: ${String(rawOutlet)}` }, { status: 400 });
    }

    const take = Math.min(Number(url.searchParams.get("take") || 50), 100);
    const periodParam = (url.searchParams.get("period") || "current").toLowerCase(); // current|previous
    const dateParam = url.searchParams.get("date") || undefined; // YYYY-MM-DD (optional when period=previous)

    // Determine time window by trading period
    // - current: from ActivePeriod.periodStartAt → now
    // - previous: if date is provided, use that calendar day window in APP_TZ; else use (today - 1)
    let fromTime: Date | null = null;
    let toTime: Date | null = null;
    if (periodParam === "current") {
      // ActivePeriod uses outletName (string). Attempt a case-insensitive match from the enum-derived name.
      const outletNameForActive = (outletEnum || 'GENERAL').replace(/_/g, " ");
      const active = await (prisma as any).activePeriod.findFirst({ where: { outletName: { equals: outletNameForActive, mode: 'insensitive' } } }).catch(() => null);
      fromTime = active?.periodStartAt ? new Date(active.periodStartAt) : null;
      if (!fromTime) {
        // Fallback to today midnight in APP_TZ to avoid spanning historical payments
        const tz = APP_TZ;
        const day = dateISOInTZ(new Date(), tz);
        const fixedOffset = tz === "Africa/Nairobi" ? "+03:00" : "+00:00";
        fromTime = new Date(`${day}T00:00:00${fixedOffset}`);
      }
    } else if (periodParam === "previous") {
      const tz = APP_TZ;
      const day = dateParam || dateISOInTZ(new Date(), tz);
      // previous period view is by calendar day for the provided date
      const fixedOffset = tz === "Africa/Nairobi" ? "+03:00" : "+00:00";
      fromTime = new Date(`${day}T00:00:00${fixedOffset}`);
      toTime = new Date(`${day}T23:59:59.999${fixedOffset}`);
    }

    // Base window filter
    const whereWindow: any = {};
    if (fromTime) whereWindow.createdAt = { gte: fromTime };
    if (toTime) whereWindow.createdAt = { ...(whereWindow.createdAt || {}), lte: toTime };

    // Mode: by=till (strict/inclusive) or by outlet (existing)
    if (byParam === "till") {
      if (!codeParam) {
        // nothing to show
        return NextResponse.json({ ok: true, mode: "till", rows: [], total: 0 });
      }
      // Show only successful payments for till view to avoid noise
      whereWindow.status = "SUCCESS" as any;
      if (!inclusive) {
        // strict: paid directly to the specified shortcode
        whereWindow.businessShortCode = codeParam;
      } else {
        const t = await (prisma as any).till.findUnique({ where: { tillNumber: codeParam } });
        if (!t) return NextResponse.json({ ok: true, mode: "till", rows: [], total: 0 });
        whereWindow.OR = [
          { businessShortCode: t.tillNumber },
          { storeNumber: t.storeNumber },
          { headOfficeNumber: t.headOfficeNumber },
        ];
      }
    } else {
      // existing outlet behavior
      whereWindow.outletCode = outletEnum;
    }

    // Fetch recent payments for this outlet within the window
    const raw = await (prisma as any).payment.findMany({
      where: whereWindow,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        amount: true,
        outletCode: true,
        msisdn: true,
        status: true,
        mpesaReceipt: true,
        businessShortCode: true,
        storeNumber: true,
        headOfficeNumber: true,
        accountReference: true,
        createdAt: true,
      },
    });

    // Map to UI-friendly shape expected by AttendantDashboard Till table
    const rows = (raw || []).map((r: any) => ({
      time: r.createdAt,
      amount: Number(r.amount || 0),
      code: r.mpesaReceipt || null,
      customer: r.msisdn || null,
      ref: r.accountReference || r.businessShortCode || null,
    }));

    // Compute total of SUCCESS amounts for this outlet (simple reflection metric)
    const agg = await (prisma as any).payment.aggregate({
      where: { ...whereWindow, status: "SUCCESS" },
      _sum: { amount: true },
    });
    const total = Number(agg?._sum?.amount || 0);

    return NextResponse.json({ ok: true, mode: byParam, outlet: rawOutlet, outletEnum, code: codeParam || null, inclusive, period: periodParam, total, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

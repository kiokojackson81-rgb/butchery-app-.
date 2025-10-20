import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDayTotals } from "@/server/finance";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "missing date or outlet" }, { status: 400 });

    // Compute expected via server helper (uses pricebook + closings + supply)
    const totals = await computeDayTotals({ date, outletName: outlet });
    const expectedSales = Number((totals as any)?.expectedSales || 0);

    // Fetch deposits and expenses for aggregates
    const [deposits, expenses] = await Promise.all([
      (prisma as any).attendantDeposit.findMany({ where: { date, outletName: outlet }, orderBy: { createdAt: "asc" } }),
      (prisma as any).attendantExpense.findMany({ where: { date, outletName: outlet } }),
    ]);

    const expensesSum = (expenses || []).reduce((a: number, e: any) => a + (Number(e?.amount) || 0), 0);
    const depValid = (deposits || []).filter((d: any) => (d?.status || "PENDING") === "VALID");
    const depPending = (deposits || []).filter((d: any) => (d?.status || "PENDING") === "PENDING");
    const depInvalid = (deposits || []).filter((d: any) => (d?.status || "PENDING") === "INVALID");
    const sum = (arr: any[]) => arr.reduce((a, d) => a + (Number(d?.amount) || 0), 0);
    const depositedValid = sum(depValid);
    const depositedPending = sum(depPending);
    const depositedInvalid = sum(depInvalid);
    const depositedNonInvalid = depositedValid + depositedPending; // valid + pending

    // Projected till mirrors the client logic
    const projectedTill = expectedSales - depositedNonInvalid - expensesSum;
    const variance = projectedTill; // alias for clarity

    return NextResponse.json({ ok: true, date, outlet, totals: {
      expectedSales,
      expenses: expensesSum,
      depositedValid,
      depositedPending,
      depositedInvalid,
      depositedNonInvalid,
      projectedTill,
      variance,
    }});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

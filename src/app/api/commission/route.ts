import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCommissionPeriodFor } from "@/server/commission";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || new Date().toISOString().slice(0,10)).slice(0,10);
    const outlet = (searchParams.get("outlet") || "").trim();
    const supCode = (searchParams.get("supervisor") || "").trim() || undefined;
    const status = (searchParams.get("status") || "").trim() || undefined;
    const { start, end, key } = getCommissionPeriodFor(date);
    const where: any = { periodKey: key, ...(outlet ? { outletName: outlet } : {}), ...(supCode ? { supervisorCode: supCode } : {}), ...(status ? { status } : {}) };
    const rows = await (prisma as any).supervisorCommission.findMany({ where, orderBy: [{ date: "asc" }, { outletName: "asc" }] });
    // Also compute totals per supervisor
    const total = rows.reduce((a: any, r: any) => {
      const k = r.supervisorCode || "__unknown__";
      const t = a[k] || { salesKsh: 0, expensesKsh: 0, wasteKsh: 0, profitKsh: 0, commissionKsh: 0 };
      t.salesKsh += r.salesKsh; t.expensesKsh += r.expensesKsh; t.wasteKsh += r.wasteKsh; t.profitKsh += r.profitKsh; t.commissionKsh += r.commissionKsh;
      a[k] = t; return a;
    }, {} as any);
    return NextResponse.json({ ok: true, period: { start, end, key }, rows, totals: total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Admin edit: update commission fields or status for a specific record id
    const body = await req.json();
    const { id, commissionKsh, commissionRate, status, note } = body || {};
    if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const data: any = {};
    if (commissionKsh !== undefined) data.commissionKsh = Number(commissionKsh) || 0;
    if (commissionRate !== undefined) data.commissionRate = Number(commissionRate) || 0;
    if (status) data.status = String(status);
    if (note !== undefined) data.note = String(note);
    const row = await (prisma as any).supervisorCommission.update({ where: { id }, data });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
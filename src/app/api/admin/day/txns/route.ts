import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

// GET /api/admin/day/txns?date=YYYY-MM-DD&outlet=Outlet%20Name
// Optional: &code=PERSON_CODE to filter deposits by person code
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = String(url.searchParams.get("date") || "").trim();
    const outlet = String(url.searchParams.get("outlet") || "").trim();
    const code = String(url.searchParams.get("code") || "").trim();
    if (!date) return NextResponse.json({ ok: false, error: "missing date" }, { status: 400 });

    // Build filters dynamically
    const depositWhere: any = { date };
    if (outlet) depositWhere.outletName = outlet;
    if (code) depositWhere.code = code;
    const expenseWhere: any = { date };
    if (outlet) expenseWhere.outletName = outlet;

    const [deposits, expenses] = await Promise.all([
      (prisma as any).attendantDeposit.findMany({ where: depositWhere, orderBy: [{ createdAt: "asc" }] }).catch(()=>[]),
      outlet ? (prisma as any).attendantExpense.findMany({ where: expenseWhere, orderBy: [{ createdAt: "asc" }] }).catch(()=>[]) : Promise.resolve([]),
    ]);
    return NextResponse.json({ ok: true, date, outlet: outlet || null, code: code || null, deposits, expenses });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}
 

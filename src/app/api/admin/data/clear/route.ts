import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ClearBody = {
  outlet?: string;
  date?: string; // YYYY-MM-DD
  include?: {
    opening?: boolean;
    closings?: boolean;
    expenses?: boolean;
    deposits?: boolean;
    till?: boolean;
    locks?: boolean; // lock + closecount
  };
};

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized", note: "Provide STATUS_PUBLIC_KEY via header x-status-key or ?key=" },
    { status: 401 }
  );
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const providedKey = req.headers.get("x-status-key") || url.searchParams.get("key") || "";
    const requiredKey = process.env.STATUS_PUBLIC_KEY || "";
    if (!requiredKey || providedKey !== requiredKey) return unauthorized();

    const body = (await req.json().catch(() => ({}))) as ClearBody;
    const outlet = (body.outlet || "").trim();
    const date = (body.date || "").trim();
    if (!outlet || !date) return NextResponse.json({ ok: false, error: "missing outlet or date" }, { status: 400 });

    const include = body.include || {};
    const want = {
      opening: include.opening !== false,
      closings: include.closings !== false,
      expenses: include.expenses !== false,
      deposits: include.deposits !== false,
      till: include.till !== false,
      locks: include.locks !== false,
    };

    const results: Record<string, number> = {};

    async function tryDelete(model: string, where: any, label: string) {
      try {
        const r = await (prisma as any)[model].deleteMany({ where });
        results[label] = Number(r?.count || 0);
      } catch {
        results[label] = 0;
      }
    }

    // Per-day, per-outlet tables
    if (want.closings) await tryDelete("attendantClosing", { outletName: outlet, date }, "closings");
    if (want.expenses) await tryDelete("attendantExpense", { outletName: outlet, date }, "expenses");
    if (want.deposits) await tryDelete("attendantDeposit", { outletName: outlet, date }, "deposits");
    if (want.till)     await tryDelete("attendantTillCount", { outletName: outlet, date }, "till");
    if (want.opening)  await tryDelete("supplyOpeningRow", { outletName: outlet, date }, "opening");

    // Reset lock + close-count settings
    if (want.locks) {
      const keys = [
        `lock:attendant:${date}:${outlet}`,
        `period:closecount:${date}:${outlet}`,
      ];
      try {
        const r = await (prisma as any).setting.deleteMany({ where: { key: { in: keys } } });
        results["settings"] = Number(r?.count || 0);
      } catch { results["settings"] = 0; }
    }

    return NextResponse.json({ ok: true, outlet, date, deleted: results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getPeriodState, countActiveProducts } from "@/server/trading_period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const outlet = url.searchParams.get("outlet");
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (!outlet) return NextResponse.json({ ok: false, error: "Missing outlet" }, { status: 400 });
    const state = await getPeriodState(outlet, date);
    const counts = await countActiveProducts(outlet, date);
    return NextResponse.json({ ok: true, outlet, date, state, products: counts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

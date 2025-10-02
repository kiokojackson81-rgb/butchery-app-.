import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { notifySupplyPosted } from "@/server/supply_notify";

export async function POST(req: Request) {
  try {
    const { outlet, date, supplierCode } = (await req.json()) as { outlet: string; date?: string; supplierCode?: string };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });
    const res = await notifySupplyPosted({ outletName, date, supplierCode: supplierCode || null });
    return NextResponse.json({ ok: true, result: res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

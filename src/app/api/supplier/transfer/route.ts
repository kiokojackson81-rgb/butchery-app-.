// app/api/supplier/transfer/route.ts
import { NextResponse } from "next/server";
import { createTransfer } from "@/server/supplier/supplier.service";
import { notifyTransferCreated } from "@/server/supplier/supplier.notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const t = await createTransfer(body);
    const desc = `${t.itemKey} ${t.qty}${t.unit} ${t.fromOutletName} → ${t.toOutletName}`;
    await notifyTransferCreated(t.fromOutletName, t.toOutletName, body.date, desc);
    return NextResponse.json({ ok: true, transfer: t });
  } catch (e: any) {
    const code = e?.code === 400 ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: code });
  }
}

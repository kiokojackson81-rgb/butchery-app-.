// app/api/supplier/lock-day/route.ts
import { NextResponse } from "next/server";
import { lockDay, getDaySnapshot } from "@/server/supplier/supplier.service";
import { validateActorCode } from "@/server/auth/roles";
import { notifyOpeningLocked } from "@/server/supplier/supplier.notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const actorInput = (body?.actorCode as string) || (req.headers.get("x-actor-code") as string) || null;
  const actorCode = (await validateActorCode("supplier", actorInput)) || "SUPPLIER";
    const setting = await lockDay(body, actorCode);

    const snap = await getDaySnapshot(body.date, body.outlet);
    const line = snap.rows.map((r: any) => `${r.itemKey}:${r.qty}${r.unit}`).slice(0, 6).join(", ");
    await notifyOpeningLocked(body.outlet, body.date, line);

    return NextResponse.json({ ok: true, locked: true, setting });
  } catch (e: any) {
    const code = e?.code === 400 ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: code });
  }
}

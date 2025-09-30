// app/api/supplier/dispute/route.ts
import { NextResponse } from "next/server";
import { createDispute } from "@/server/supplier/supplier.service";
import { notifySupervisorDispute } from "@/server/supplier/supplier.notifications";
import { validateActorCode } from "@/server/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const actorInput = (body?.actorCode as string) || (req.headers.get("x-actor-code") as string) || null;
  const actorCode = (await validateActorCode("supplier", actorInput)) || "SUPPLIER";
    const ri = await createDispute(body, actorCode);
    const p: any = ri.payload as any;
    const desc = `${p?.itemKey} ${p?.qty ?? ""} — ${p?.reason ?? ""}`;
    await notifySupervisorDispute(body.outlet, body.date, desc);
    return NextResponse.json({ ok: true, reviewItem: ri });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 400 });
  }
}

// app/api/supplier/request-edit/route.ts
import { NextResponse } from "next/server";
import { requestEdit } from "@/server/supplier/supplier.service";
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
    const ri = await requestEdit(body, actorCode);
    await notifySupervisorDispute(body.outlet, body.date, `Edit requested: ${body.rows.length} row(s)`);
    return NextResponse.json({ ok: true, reviewItem: ri });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 400 });
  }
}

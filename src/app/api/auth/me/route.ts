import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRoleSession } from "@/lib/roleSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Prefer attendant DB session when present
  const sess = await getSession();
  if (sess) {
    const outletObj = (sess as any).attendant?.outletRef ?? null;
    const outletCode = (sess as any).outletCode || (outletObj?.code ?? null);
    return NextResponse.json({
      ok: true,
      role: "attendant",
      attendant: {
        id: (sess as any).attendant?.id,
        name: (sess as any).attendant?.name,
        code: (sess as any).attendant?.loginCode || null,
      },
      outlet: outletObj,
      outletCode,
    });
  }

  // Fallback to unified role cookie for supervisor/supplier
  const role = await getRoleSession();
  if (role) {
    return NextResponse.json({ ok: true, role: role.role, code: role.code, outlet: role.outlet ?? null });
  }
  return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

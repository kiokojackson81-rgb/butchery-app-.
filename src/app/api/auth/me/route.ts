import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getRoleSession } from "@/lib/roleSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rolePayload = await getRoleSession().catch(() => null);
  const roleFromCookie = rolePayload?.role || "attendant";
  // Prefer attendant DB session when present
  const sess = await getSession();
  if (sess) {
    const outletObj = (sess as any).attendant?.outletRef ?? null;
    const outletCode = (sess as any).outletCode || (outletObj?.code ?? null);
    return NextResponse.json({
      ok: true,
      role: roleFromCookie,
      attendant: {
        id: (sess as any).attendant?.id,
        name: (sess as any).attendant?.name,
        code: (sess as any).attendant?.loginCode || null,
        role: roleFromCookie,
      },
      outlet: outletObj,
      outletCode,
    });
  }

  // Fallback to unified role cookie for supervisor/supplier
  if (rolePayload) {
    return NextResponse.json({ ok: true, role: rolePayload.role, code: rolePayload.code, outlet: rolePayload.outlet ?? null });
  }
  return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

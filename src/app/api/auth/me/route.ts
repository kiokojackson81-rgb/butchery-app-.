import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({
    ok: true,
    attendant: {
      id: sess.attendant.id,
      name: sess.attendant.name,
    },
    outlet: sess.attendant.outletRef ?? null,
    outletCode: sess.outletCode ?? null,
  });
}

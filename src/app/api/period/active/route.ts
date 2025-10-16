import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  if (!outlet) return NextResponse.json({ ok: true, active: null });

  const active = await prisma.activePeriod.findUnique({ where: { outletName: outlet } });
  if (!active) return NextResponse.json({ ok: true, active: null });

  return NextResponse.json({ ok: true, active: { periodStartAt: active.periodStartAt } });
}

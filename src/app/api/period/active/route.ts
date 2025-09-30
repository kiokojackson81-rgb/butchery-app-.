import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  if (!outlet) return NextResponse.json({ ok: true, active: null });

  const active = await prisma.activePeriod.findUnique({ where: { outletName: outlet } });
  if (!active) return NextResponse.json({ ok: true, active: null });

  return NextResponse.json({ ok: true, active: { periodStartAt: active.periodStartAt } });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const rows = (await (prisma as any).$queryRawUnsafe(
      'SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment" ORDER BY code ASC'
    )) as Array<{ code: string; outlet: string; productKeys: any; updatedAt: string }>;
    return NextResponse.json(rows);
  } catch (e) {
    console.error("assignments list error", e);
    return NextResponse.json({ ok: false, error: "Failed to fetch" }, { status: 500 });
  }
}

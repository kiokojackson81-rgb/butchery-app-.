import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [outlets, attendants, assignments] = await Promise.all([
      (prisma as any).outlet.findMany({ orderBy: { code: "asc" } }),
      (prisma as any).attendant.findMany({ orderBy: { name: "asc" } }),
      (prisma as any).attendantAssignment.findMany({ orderBy: { code: "asc" } }),
    ]);

    return NextResponse.json({ ok: true, outlets, attendants, assignments });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

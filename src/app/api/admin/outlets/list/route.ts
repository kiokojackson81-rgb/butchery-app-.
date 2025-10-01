import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const outlets = await (prisma as any).outlet.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ ok: true, outlets });
  } catch (e: any) {
    const message = e?.message ? String(e.message) : "Failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

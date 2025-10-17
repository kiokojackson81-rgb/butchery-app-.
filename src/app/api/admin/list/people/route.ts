import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
  try {
    const rows = await (prisma as any).personCode.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, role: true, active: true },
    }).catch(()=>[]);
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}

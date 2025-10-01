import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

const KEY = "low_stock_thresholds";

export async function GET() {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: KEY } });
    return NextResponse.json({ ok: true, thresholds: row?.value ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { thresholds } = await req.json();
    if (thresholds && typeof thresholds === "object") {
      await (prisma as any).setting.upsert({
        where: { key: KEY },
        update: { value: thresholds },
        create: { key: KEY, value: thresholds },
      });
      return NextResponse.json({ ok: true });
    }
    // if null/empty -> treat as delete
    await (prisma as any).setting.delete({ where: { key: KEY } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await (prisma as any).setting.delete({ where: { key: KEY } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

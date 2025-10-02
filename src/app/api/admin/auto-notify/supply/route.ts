import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY = "auto_notify_supply";

export async function GET() {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: KEY } });
    const enabled = row?.value === true || String(row?.value).toLowerCase() === "true";
    return NextResponse.json({ ok: true, enabled });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const enabled = !!body?.enabled;
    await (prisma as any).setting.upsert({
      where: { key: KEY },
      update: { value: enabled },
      create: { key: KEY, value: enabled },
    });
    return NextResponse.json({ ok: true, enabled });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

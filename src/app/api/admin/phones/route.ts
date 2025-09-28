import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const list = await (prisma as any).phoneMapping.findMany({ select: { code: true, phoneE164: true } });
    return NextResponse.json(list ?? []);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const { code, role, phoneE164, outlet } = await req.json();
    if (!code || !role || !phoneE164) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
    await (prisma as any).phoneMapping.upsert({
      where: { code },
      update: { role, phoneE164, outlet },
      create: { code, role, phoneE164, outlet },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}

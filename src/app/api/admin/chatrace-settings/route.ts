import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const s = await (prisma as any).chatraceSetting.findUnique({ where: { id: 1 } });
    return NextResponse.json(s || null);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) });
  }
}

export async function POST(req: Request) {
  try {
    const { apiBase, apiKey, fromPhone } = await req.json();
    if (!apiBase || !apiKey) return NextResponse.json({ ok: false, error: "Missing apiBase/apiKey" }, { status: 400 });
    await (prisma as any).chatraceSetting.upsert({
      where: { id: 1 },
      update: { apiBase, apiKey, fromPhone },
      create: { id: 1, apiBase, apiKey, fromPhone },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}

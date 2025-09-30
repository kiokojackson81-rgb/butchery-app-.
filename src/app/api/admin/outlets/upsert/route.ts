import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { code, name, active = true } = (await req.json()) as {
      code: string;
      name: string;
      active?: boolean;
    };
    if (!code || !name) return NextResponse.json({ ok: false, error: "code & name required" }, { status: 400 });

    const existing = await (prisma as any).outlet.findFirst({ where: { code } });
    if (existing) {
      await (prisma as any).outlet.update({ where: { id: existing.id }, data: { name, active } });
    } else {
      await (prisma as any).outlet.create({ data: { code, name, active, id: `out_${Date.now()}` } });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

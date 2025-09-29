import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/normalizeCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { name, loginCode, phone, role = "attendant", active = true } = (await req.json()) as {
      name: string;
      loginCode: string;
      phone?: string;
      role?: string;
      active?: boolean;
    };

    if (!name || !loginCode) return NextResponse.json({ ok: false, error: "name & loginCode required" }, { status: 400 });

    const norm = normalizeCode(loginCode);
    const existing = await (prisma as any).attendant.findFirst({ where: { loginCode: norm } });
    if (existing) {
      await (prisma as any).attendant.update({
        where: { id: existing.id },
        data: { name },
      });
    } else {
      await (prisma as any).attendant.create({
        data: { id: `att_${Date.now()}`, name, loginCode: norm },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

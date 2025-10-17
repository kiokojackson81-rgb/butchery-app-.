import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
  try {
    const [outlets, products, people] = await Promise.all([
      (prisma as any).outlet.findMany({ where: { active: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, active: true } }),
      (prisma as any).product.findMany({ where: { active: false }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true, unit: true, active: true } }),
      (prisma as any).personCode.findMany({ where: { active: false }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, role: true, active: true } }),
    ]);
    return NextResponse.json({ ok: true, outlets, products, people });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

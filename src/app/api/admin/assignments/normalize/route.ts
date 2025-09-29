import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function norm(s: string) {
  return (s || "").toString().trim().replace(/\s+/g, "").toLowerCase();
}

export async function POST() {
  try {
    const all = await (prisma as any).attendantAssignment.findMany();
    let changed = 0;
    for (const row of all) {
      const want = norm(row.code);
      if (row.code !== want) {
        const clash = await (prisma as any).attendantAssignment.findUnique({ where: { code: want } }).catch(() => null);
        if (clash) {
          const keep = row.updatedAt > clash.updatedAt ? row : clash;
          const drop = keep.id === row.id ? clash : row;
          await (prisma as any).attendantAssignment.update({ where: { id: keep.id }, data: { code: want, outlet: keep.outlet, productKeys: keep.productKeys } });
          await (prisma as any).attendantAssignment.delete({ where: { id: drop.id } });
        } else {
          await (prisma as any).attendantAssignment.update({ where: { id: row.id }, data: { code: want } });
        }
        changed++;
      }
    }
    return NextResponse.json({ ok: true, changed });
  } catch (e: any) {
    console.error("normalize error", e);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

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
    const all = await (prisma as any).$queryRawUnsafe(
      'SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment"'
    );
    let changed = 0;
    for (const row of all) {
      const want = norm(row.code);
      if (row.code !== want) {
        const clash = await (prisma as any).$queryRawUnsafe(
          'SELECT code, outlet, "productKeys", "updatedAt" FROM "AttendantAssignment" WHERE code = $1',
          want
        );
        if (Array.isArray(clash) && clash.length > 0) {
          // prefer the most recent updatedAt if present
          const target = clash[0];
          if (row.updatedAt && target.updatedAt && row.updatedAt > target.updatedAt) {
            await (prisma as any).$executeRawUnsafe(
              'UPDATE "AttendantAssignment" SET code = $1 WHERE code = $2',
              want,
              row.code
            );
            await (prisma as any).$executeRawUnsafe('DELETE FROM "AttendantAssignment" WHERE code = $1', target.code);
          } else {
            await (prisma as any).$executeRawUnsafe('DELETE FROM "AttendantAssignment" WHERE code = $1', row.code);
          }
        } else {
          await (prisma as any).$executeRawUnsafe(
            'UPDATE "AttendantAssignment" SET code = $1 WHERE code = $2',
            want,
            row.code
          );
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

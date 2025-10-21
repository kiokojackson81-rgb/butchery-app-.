import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    try {
      // Attempt hard delete first
      await (prisma as any).outlet.delete({ where: { id } });
    } catch (e: any) {
      // Prisma P2025 = Record not found, P2003 = Foreign key constraint
      const msg = String(e?.message || '');
      if (/Foreign key constraint|P2003/i.test(msg)) {
        // Deactivate instead
        try {
          await (prisma as any).outlet.update({ where: { id }, data: { active: false } });
        } catch (ee: any) {
          const inner = ee?.message || String(ee || '');
          return NextResponse.json({ ok: false, error: inner }, { status: 500 });
        }
        // return 409 to indicate soft-deactivate due to references
        const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json({ ok: false, error: 'referenced', outlets: latest }, { status: 409 });
      }
      if (/Record to delete does not exist|P2025/i.test(msg)) {
        // Already gone — return current list
        const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json({ ok: true, outlets: latest });
      }
      // Other errors
      throw e;
    }

    // On success return updated list
    const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json({ ok: true, outlets: latest });
  } catch (e: any) {
    const message = e?.message ? String(e.message) : 'Failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

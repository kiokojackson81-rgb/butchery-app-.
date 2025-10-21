import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request, { params }: { params: { id?: string } }) {
  try {
    const id = typeof params?.id === 'string' ? params.id : null;
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    try {
      await (prisma as any).outlet.delete({ where: { id } });
    } catch (e: any) {
      const msg = String(e?.message || '');
      // Foreign key references -> soft deactivate
      if (/Foreign key constraint|P2003/i.test(msg)) {
        try {
          await (prisma as any).outlet.update({ where: { id }, data: { active: false } });
        } catch (ee: any) {
          const inner = ee?.message || String(ee || '');
          return NextResponse.json({ ok: false, error: inner }, { status: 500 });
        }
        const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json({ ok: false, error: 'referenced', outlets: latest }, { status: 409 });
      }
      if (/Record to delete does not exist|P2025/i.test(msg)) {
        const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json({ ok: true, outlets: latest });
      }
      throw e;
    }

    const latest = await (prisma as any).outlet.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json({ ok: true, outlets: latest });
  } catch (e: any) {
    const message = e?.message ? String(e.message) : 'Failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

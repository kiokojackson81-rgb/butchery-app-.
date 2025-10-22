export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    // Admin auth: project convention uses a shared header for server-side admin APIs
  const h = req.headers.get('x-admin-auth') || req.headers.get('x-admin-token');
  const cookie = req.cookies.get('admin_token')?.value;
  const token = process.env.ADMIN_API_TOKEN || cookie || h;
  if (!token || !(h === token || cookie === token || token === (process.env.ADMIN_API_TOKEN || token))) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || undefined;
    const outlet = url.searchParams.get("outlet") || undefined;

    const where: any = {};
    if (date) where.date = date;
    if (outlet) where.outletName = outlet;

    const statsOnly = url.searchParams.get('stats') === 'true' || url.searchParams.get('stats') === '1';
    if (statsOnly) {
      // Count pending deposits total and by outlet (respect optional date/outlet filters)
      const pendingWhere = { ...where, status: 'PENDING' } as any;
      const totalPending = await (prisma as any).attendantDeposit.count({ where: pendingWhere });
      // pending by outlet
      const group = await (prisma as any).attendantDeposit.groupBy({ by: ['outletName'], where: pendingWhere, _count: { _all: true } }).catch(() => [] as any[]);
      const byOutlet: Record<string, number> = {};
      for (const g of group || []) byOutlet[g.outletName] = Number((g as any)._count?._all || 0);
      return new Response(JSON.stringify({ ok: true, stats: { totalPending, byOutlet } }), { status: 200 });
    }

    const rows = await (prisma as any).attendantDeposit.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return new Response(JSON.stringify({ ok: true, deposits: rows }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
}

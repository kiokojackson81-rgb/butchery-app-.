import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { queryDevWaLogs } from "@/lib/dev_wa_logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") || 50)));
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const after = searchParams.get("after") || undefined;
    const to = (searchParams.get("to") || "").replace(/[^0-9+]/g, "").replace(/^\+/, "");

    // Build server-side filters
    let where: any = {};
    const ors: any[] = [];
    if (to) {
      const e164 = to.startsWith("+") ? to : "+" + to;
      ors.push({ payload: { path: ["meta", "phoneE164"], equals: e164 } as any });
  ors.push({ payload: { path: ["request", "to"], equals: to } as any });
  ors.push({ payload: { path: ["to"], equals: to } as any });
  ors.push({ payload: { path: ["body", "to"], equals: to } as any });
      // Some logs store phone directly on payload.phone (e.g., LOGIN_PROMPT markers)
      ors.push({ payload: { path: ["phone"], equals: e164 } as any });
    }
    if (q) {
      ors.push({ templateName: { contains: q } });
      ors.push({ status: { contains: q } });
    }
    if (ors.length) where = { OR: ors };

    try {
      const rows = await (prisma as any).waMessageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        select: {
          id: true,
          createdAt: true,
          direction: true,
          templateName: true,
          status: true,
          waMessageId: true,
          payload: true,
        },
      });
      return NextResponse.json({ ok: true, rows });
    } catch (e) {
      // DB not available: fall back to in-memory dev logs
      try {
        const toParam = to || undefined;
        const rows = queryDevWaLogs({ to: toParam, q, limit });
        return NextResponse.json({ ok: true, rows });
      } catch (err: any) {
        return NextResponse.json({ ok: false, error: String(err || "dev logs failed") }, { status: 500 });
      }
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

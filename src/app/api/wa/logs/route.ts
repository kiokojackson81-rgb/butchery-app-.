import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    let where: any = {};
    // Simple contains on JSON payload stringified; DB impl can be optimized later
    if (q) where = { OR: [
      { templateName: { contains: q } },
      { status: { contains: q } },
    ] };

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

    // Optional filter by recipient phone (normalized E.164 without '+')
    const filtered = to
      ? rows.filter((r: any) => {
          const p = r?.payload as any;
          const candidate = p?.request?.to || p?.to || p?.request?.recipient || "";
          const norm = String(candidate).replace(/[^0-9+]/g, "").replace(/^\+/, "");
          return norm ? norm.endsWith(to) || norm === to : false;
        })
      : rows;

    return NextResponse.json({ ok: true, rows: filtered });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

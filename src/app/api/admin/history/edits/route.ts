import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
    const rows = await (prisma as any).setting.findMany({
      where: { key: { startsWith: "admin_edit:" } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { key: true, value: true, createdAt: true },
    });
    const events = (rows || []).map((r: any) => {
      const [, ts, type, id] = String(r.key).split(":");
      const v = (r.value as any) || {};
      return {
        key: r.key,
        at: v.at || r.createdAt,
        type: v.type || type,
        id: v.id || id,
        before: v.before || null,
        after: v.after || null,
      };
    });
    return NextResponse.json({ ok: true, events });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

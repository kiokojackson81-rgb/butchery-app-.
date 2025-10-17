import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    // Wipe events are stored in Setting with key pattern: wipe_event:<ts>:<type>:<target>
    const rows = await (prisma as any).setting.findMany({
      where: { key: { startsWith: "wipe_event:" } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { key: true, value: true, createdAt: true },
    });

    const events = (rows || []).map((r: any) => {
      const [, ts, type, target] = String(r.key).split(":");
      const v = (r.value as any) || {};
      return {
        key: r.key,
        at: v.at || r.createdAt,
        type: v.type || type,
        target: v.target || target,
        onlyIfInactive: !!v.onlyIfInactive,
        counts: v.counts || {},
      };
    });

    return NextResponse.json({ ok: true, events });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

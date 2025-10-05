import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toInt(v: string | null | undefined, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const search = url.searchParams;

    const limit = toInt(search.get("limit"), 50, 1, 200);
    const direction = search.get("direction"); // "in" | "out"
    const status = search.get("status"); // SENT | ERROR | DELIVERED | READ | etc.
    const templateName = search.get("template");
    const wamid = search.get("wamid");
    const phoneE164 = search.get("phone"); // expects +E164
    const sinceMin = toInt(search.get("sinceMin"), 1440, 1, 10080); // default 24h, cap 7 days

    const since = new Date(Date.now() - sinceMin * 60_000);

    const where: any = { createdAt: { gt: since } };
    if (direction === "in" || direction === "out") where.direction = direction;
    if (status) where.status = status;
    if (templateName) where.templateName = templateName;
    if (wamid) where.waMessageId = wamid;

    // Optional filter by phone: payload.meta.phoneE164 equals
    if (phoneE164) {
      where.AND = where.AND || [];
      where.AND.push({ payload: { path: ["meta", "phoneE164"], equals: phoneE164 } as any });
    }

    const logs = await (prisma as any).waMessageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
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

    return NextResponse.json({ ok: true, count: logs.length, logs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

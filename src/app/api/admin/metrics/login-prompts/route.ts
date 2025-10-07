import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toNumber(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = toNumber(searchParams.get("hours"), 24);
    const since = new Date(Date.now() - hours * 3600_000);

    // Fetch recent login prompt markers (WARN) and inbound total for unauthenticated rate
    const [prompts, inbound] = await Promise.all([
      (prisma as any).waMessageLog.findMany({
        where: { createdAt: { gt: since }, status: "LOGIN_PROMPT" },
        select: { id: true, createdAt: true, payload: true },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }).catch(() => []),
      (prisma as any).waMessageLog.count({ where: { createdAt: { gt: since }, direction: "in" } }).catch(() => 0),
    ]);

    // Group by phone
    const byPhone = new Map<string, number>();
    for (const r of prompts as any[]) {
      const p = (r?.payload as any) || {};
      const phone = p?.phone || p?.meta?.phoneE164 || "";
      if (!phone) continue;
      byPhone.set(phone, (byPhone.get(phone) || 0) + 1);
    }
    const perPhone = Array.from(byPhone.entries()).map(([phone, count]) => ({ phone, count })).sort((a, b) => b.count - a.count);
    const totalPrompts = (prompts as any[])?.length || 0;
    const uniquePhones = byPhone.size;
    const averagePerPhone = uniquePhones ? totalPrompts / uniquePhones : 0;
    const unauthenticatedRate = inbound ? totalPrompts / inbound : 0;

    return NextResponse.json({
      ok: true,
      windowHours: hours,
      totalPrompts,
      uniquePhones,
      averagePerPhone,
      unauthenticatedRate,
      perPhone,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

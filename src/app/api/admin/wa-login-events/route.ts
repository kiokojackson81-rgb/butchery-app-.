import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || 50)));
    const sinceMin = Math.min(7*24*60, Math.max(1, Number(searchParams.get("sinceMin") || 1440)));
    const since = new Date(Date.now() - sinceMin * 60_000);

    // Read recent WA logs of login-related types
    const rows = await (prisma as any).waMessageLog.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          { type: "LOGIN_FAIL" },
          { type: "ASSIGNMENT" },
          { type: "TEMPLATE_OUTBOUND" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, type: true, status: true, payload: true, templateName: true },
    }).catch(() => []);

    const events = (rows as any[]).map((r) => ({
      id: r.id,
      ts: r.createdAt,
      type: r.type || null,
      status: r.status || null,
      template: r.templateName || null,
      phone: r?.payload?.meta?.phoneE164 || null,
      outlet: r?.payload?.meta?.outlet || null,
    }));
    return NextResponse.json({ ok: true, events });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

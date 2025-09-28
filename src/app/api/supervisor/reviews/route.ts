import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/supervisor/reviews
// Body can be:
// - Array<{ type,outlet,date,payload,status? }>
// - { items: Array<...> }
// - Single object { type,outlet,date,payload,status? }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    let items: any[] = [];
    if (Array.isArray(body)) items = body;
    else if (Array.isArray(body?.items)) items = body.items;
    else if (body && typeof body === "object" && (body.type || body.outlet || body.date)) items = [body];

    if (!items.length) return NextResponse.json({ ok: false, error: "No items" }, { status: 400 });

    const created = await (prisma as any).$transaction(
      items.map((it: any) => (prisma as any).reviewItem.create({
        data: {
          type: String(it.type || ""),
          outlet: String(it.outlet || ""),
          date: new Date(it.date || new Date()),
          payload: it.payload ?? {},
          status: String(it.status || "pending"),
        },
      }))
    );

    return NextResponse.json({ ok: true, count: created.length, items: created });
  } catch (e: any) {
    console.warn("reviews.create.fail", e?.message || e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// GET /api/supervisor/reviews?type=&outlet=&from=&to=
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "").trim();
    const outlet = (searchParams.get("outlet") || "").trim();
    const status = (searchParams.get("status") || "").trim();
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const today = new Date();
    const from = fromStr ? new Date(fromStr) : new Date(today.toISOString().slice(0,10));
    const to = toStr ? new Date(toStr) : new Date(today.toISOString().slice(0,10));
    // widen to end of day
    const toEnd = new Date(to);
    toEnd.setHours(23,59,59,999);

    const where: any = {
      date: { gte: from, lte: toEnd },
    };
    if (type) where.type = type;
    if (outlet) where.outlet = outlet;
    if (status) where.status = status;

    const items = await (prisma as any).reviewItem.findMany({ where, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.warn("reviews.list.fail", e?.message || e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

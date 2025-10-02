import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { outlet, items } = (await req.json()) as {
      outlet: string;
      items: Array<{ name: string; amount: number }>;
    };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);

    await prisma.$transaction(async (tx) => {
      await tx.attendantExpense.deleteMany({ where: { date, outletName } });
      const data = (items || [])
        .map((i) => {
          const name = (i?.name ?? "").trim();
          const rawAmount = Number(i?.amount ?? 0);
          const amount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
          return { date, outletName, name, amount };
        })
        .filter((d) => d.name && d.amount > 0);

      if (data.length) await tx.attendantExpense.createMany({ data });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").slice(0, 10);
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

    const rows = await (prisma as any).attendantExpense.findMany({
      where: { date, outletName: outlet },
      select: { name: true, amount: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

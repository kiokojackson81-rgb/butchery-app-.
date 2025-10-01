import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { outlet, items } = (await req.json()) as {
    outlet: string;
    items: Array<{ name: string; amount: number }>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const date = new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    await tx.attendantExpense.deleteMany({ where: { date, outletName: outlet } });
    const data = (items || [])
      .map((i) => ({ date, outletName: outlet, name: i.name?.trim() || "", amount: Number(i.amount || 0) }))
      .filter((d) => d.name && d.amount > 0);

    if (data.length) await tx.attendantExpense.createMany({ data });
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { DepositStatus } from "@prisma/client";

export async function POST(req: Request) {
  const { outlet, entries } = (await req.json()) as {
    outlet: string;
    entries: Array<{ code?: string; amount?: number; note?: string; status?: "VALID" | "PENDING" | "INVALID" }>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const date = new Date().toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    await tx.attendantDeposit.deleteMany({ where: { date, outletName: outlet } });
    const data = (entries || [])
      .map((e) => ({
        date,
        outletName: outlet,
        code: e.code || null,
        note: e.note || null,
        amount: Number(e.amount || 0),
        status: ((e.status as DepositStatus) || "PENDING") as DepositStatus,
      }))
      .filter((d) => d.amount > 0 || (d.code && d.code.trim() !== ""));

    if (data.length) await tx.attendantDeposit.createMany({ data });
  });

  return NextResponse.json({ ok: true });
}

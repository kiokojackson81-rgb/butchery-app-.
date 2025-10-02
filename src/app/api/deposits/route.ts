import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { DepositStatus } from "@prisma/client";

export async function POST(req: Request) {
  try {
    const { outlet, entries } = (await req.json()) as {
      outlet: string;
      entries: Array<{ code?: string; amount?: number; note?: string; status?: "VALID" | "PENDING" | "INVALID" }>;
    };
    const outletName = (outlet || "").trim();
    if (!outletName) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);

    await prisma.$transaction(async (tx) => {
      await tx.attendantDeposit.deleteMany({ where: { date, outletName } });
      const data = (entries || [])
        .map((e) => {
          const code = (e.code ?? "").trim();
          const amountRaw = Number(e.amount ?? 0);
          const amount = Number.isFinite(amountRaw) ? Math.max(0, amountRaw) : 0;
          const status = ((e.status as DepositStatus) || "PENDING") as DepositStatus;
          const note = (e.note ?? null) as string | null;
          return {
            date,
            outletName,
            code: code || null,
            note,
            amount,
            status,
          };
        })
        .filter((d) => d.amount > 0 || (d.code && d.code !== ""));

      if (data.length) await tx.attendantDeposit.createMany({ data });
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

    const rows = await (prisma as any).attendantDeposit.findMany({
      where: { date, outletName: outlet },
      select: { code: true, amount: true, note: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

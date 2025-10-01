import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendClosingSubmitted } from "@/lib/wa";

export async function POST(req: Request) {
  const { outlet, date, closingMap, wasteMap } = (await req.json()) as {
    outlet: string;
    date?: string;
    closingMap: Record<string, number>;
    wasteMap: Record<string, number>;
  };
  if (!outlet) return NextResponse.json({ ok: false, error: "outlet required" }, { status: 400 });

  const day = date || new Date().toISOString().slice(0, 10);
  const keys = Array.from(new Set([...(Object.keys(closingMap || {})), ...(Object.keys(wasteMap || {}))]));

  await prisma.$transaction(async (tx) => {
    for (const itemKey of keys) {
      const closingQty = Number(closingMap?.[itemKey] || 0);
      const wasteQty = Number(wasteMap?.[itemKey] || 0);
      await tx.attendantClosing.upsert({
        where: { date_outletName_itemKey: { date: day, outletName: outlet, itemKey } },
        create: { date: day, outletName: outlet, itemKey, closingQty, wasteQty },
        update: { closingQty, wasteQty },
      });
    }
  });

  // Try to notify the submitting attendant if we can resolve their phone.
  try {
    // Best-effort: resolve current session's login code via /api/auth/me pattern is not directly available here.
    // Instead, notify all mapped phones for attendants at this outlet.
    const maps = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet } });
    const codes = maps.map((m: any) => m.code).filter(Boolean);
    const attendants = codes.length
      ? await (prisma as any).attendant.findMany({ where: { loginCode: { in: codes } } })
      : [];
    const nameByCode = new Map<string, string>();
    for (const a of attendants) {
      if (a?.loginCode) nameByCode.set(a.loginCode, a.name || a.loginCode);
    }
    // A very rough expected value: number of items submitted (business can refine to expected Ksh)
    const expected = Object.keys(closingMap || {}).length;
    await Promise.allSettled(
      maps.map((m: any) =>
        sendClosingSubmitted(m.phoneE164, nameByCode.get(m.code) || m.code || "Attendant", expected)
      )
    );
  } catch {}

  return NextResponse.json({ ok: true });
}

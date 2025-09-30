import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";
import { chatraceSendText } from "@/lib/chatrace";
import { FLAGS } from "@/lib/flags";
import { sendLowStockAlert } from "@/lib/wa";

const DEFAULT_THRESHOLDS: Record<string, number> = {
  beef: 10,
  goat: 8,
  liver: 5,
  kuku: 5,
  samosas: 30,
  mutura: 20,
  potatoes: 10,
  matumbo: 5,
};

async function getThresholds(): Promise<Record<string, number>> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: "low_stock_thresholds" } });
    if (row?.value && typeof row.value === "object") return row.value as Record<string, number>;
  } catch {}
  return DEFAULT_THRESHOLDS;
}

export async function POST(req: Request) {
  try {
    const { outlet, closingMap } = (await req.json().catch(() => ({}))) as {
      outlet: string;
      closingMap: Record<string, number>;
    };
    if (!outlet || !closingMap) return NextResponse.json({ ok: false, error: "bad payload" }, { status: 400 });

    const cfg = await getThresholds();
    const low: Array<{ key: string; qty: number; min: number }> = [];
    for (const [k, qty] of Object.entries(closingMap)) {
      const min = cfg[k] ?? 0;
      if (min > 0 && Number(qty) < min) low.push({ key: k, qty: Number(qty), min });
    }
    if (low.length === 0) return NextResponse.json({ ok: true, low: [] });

    const suppliers = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier" } });
    const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });

    const list = low.map((x) => `${x.key}=${x.qty} (min ${x.min})`).join(", ");
    const msg = `\u26A0\uFE0F Low Stock @ ${outlet}: ${list}`;

    await Promise.all([
      ...(FLAGS.CHATRACE_ENABLED
        ? [
            ...suppliers.map((s: any) => chatraceSendText({ to: s.phoneE164, text: msg })),
            ...supervisors.map((s: any) => chatraceSendText({ to: s.phoneE164, text: msg })),
          ]
        : [
            ...suppliers.map((s: any) => sendLowStockAlert(s.phoneE164, msg)),
            ...supervisors.map((s: any) => sendLowStockAlert(s.phoneE164, msg)),
          ]),
    ]);

    return NextResponse.json({ ok: true, low });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

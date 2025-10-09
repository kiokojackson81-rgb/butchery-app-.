import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/lib/wa_phone";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim();
    const outlet = (searchParams.get("outlet") || "").trim();
    if (!date) return NextResponse.json({ ok: false, error: "date required" }, { status: 400 });

    const where: any = { date };
    if (outlet) {
      where.OR = [{ fromOutletName: outlet }, { toOutletName: outlet }];
    }
    const rows = await (prisma as any).supplyTransfer.findMany({ where, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as any;
  const date = String(body?.date || "").trim();
  const fromOutletName = String(body?.fromOutletName || "").trim();
  const toOutletName = String(body?.toOutletName || "").trim();
  const itemKey = String(body?.itemKey || "").trim();
  const unit = body?.unit === "pcs" ? "pcs" : "kg";
  const qtyNum = Math.max(0, Number(body?.qty || 0));

  if (!date || !fromOutletName || !toOutletName || !itemKey || qtyNum <= 0) {
    return NextResponse.json({ ok: false, error: "missing or invalid fields" }, { status: 400 });
  }
  if (fromOutletName === toOutletName) {
    return NextResponse.json({ ok: false, error: "from/to must differ" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // record transfer
    await tx.supplyTransfer.create({ data: { date, fromOutletName, toOutletName, itemKey, qty: qtyNum, unit } });

    // adjust FROM (decrement)
    const from = await tx.supplyOpeningRow.findUnique({
      where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
    });
    const fromQty = Math.max(0, (from?.qty || 0) - qtyNum);
    await tx.supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: fromOutletName, itemKey } },
      create: { date, outletName: fromOutletName, itemKey, qty: fromQty, unit, buyPrice: from?.buyPrice || 0 },
      update: { qty: fromQty },
    });

    // adjust TO (increment)
    const to = await tx.supplyOpeningRow.findUnique({
      where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
    });
    const toQty = (to?.qty || 0) + qtyNum;
    await tx.supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: toOutletName, itemKey } },
      create: { date, outletName: toOutletName, itemKey, qty: toQty, unit, buyPrice: to?.buyPrice || 0 },
      update: { qty: toQty },
    });
  });
  // WhatsApp notifications (best-effort)
  try {
    const attendantsFrom = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet: fromOutletName } });
    const attendantsTo = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet: toOutletName } });
    const supervisors = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor" } });
    const item = itemKey.toUpperCase();
    const qtyTxt = `${qtyNum}${unit}`;
    const msgFrom = `Hello. ${item} ${qtyTxt} has been transferred from your outlet (${fromOutletName}) to ${toOutletName}. If any issue, raise a dispute with your supervisor.`;
    const msgTo = `Hello. ${item} ${qtyTxt} has been transferred to your outlet (${toOutletName}) from ${fromOutletName}. If any issue, raise a dispute with your supervisor.`;
    const msgSup = `Transfer recorded: ${item} ${qtyTxt} from ${fromOutletName} to ${toOutletName} (${date}).`;
    await Promise.allSettled([
      ...attendantsFrom.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgFrom })),
      ...attendantsTo.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgTo })),
      ...supervisors.map((m: any) => m?.phoneE164 && sendOpsMessage(toGraphPhone(m.phoneE164), { kind: "free_text", text: msgSup })),
    ]);
  } catch {}

  return NextResponse.json({ ok: true });
}

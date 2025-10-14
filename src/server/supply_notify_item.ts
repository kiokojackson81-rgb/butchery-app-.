import { prisma } from "@/lib/prisma";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/lib/wa_phone";
import { SupplyItem } from "@/lib/wa_supply_notify";

// Single-item notification with dispute CTA.
// Sent to attendant only (for now) each time a single opening row is saved.
// We compute the index position among today's items for that outlet for stable referencing (D<index> in disputes).

function numFmt(v: number) { return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(v); }

export async function notifySupplyItem(opts: { outlet: string; date: string; itemKey: string }) {
  const outlet = opts.outlet.trim();
  if (!outlet) return { ok: false, reason: "no-outlet" };
  const date = opts.date.slice(0,10);
  const itemKey = opts.itemKey.trim();
  if (!itemKey) return { ok: false, reason: "no-item" };

  const rows = await (prisma as any).supplyOpeningRow.findMany({
    where: { outletName: outlet, date },
    orderBy: { id: "asc" },
  });
  if (!rows.length) return { ok: false, reason: "no-rows" };
  const idx = rows.findIndex((r: any) => r.itemKey === itemKey);
  if (idx === -1) return { ok: false, reason: "not-found" };
  const row = rows[idx];
  const position = idx + 1;
  const total = rows.length;

  const attendant = await (prisma as any).phoneMapping.findFirst({ where: { role: "attendant", outlet }, select: { phoneE164: true } });
  if (!attendant?.phoneE164) return { ok: false, reason: "no-attendant-phone" };

  const unit = row.unit || "kg";
  const price = Number(row.buyPrice || 0);
  const qty = Number(row.qty || 0);
  const value = price ? price * qty : 0;
  const money = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.round(value));
  const priceStr = price ? ` @ ${price}` : "";
  const valStr = value ? ` = ${money}` : "";

  const msgLines = [
    `Item ${position}/${total}`,
    `${row.itemKey} ${numFmt(qty)}${unit}${priceStr}${valStr}`.trim(),
    ``,
    `If correct ignore. To dispute reply D${position}`,
    `LIST = show all items today`,
  ];

  try {
    await sendOpsMessage(toGraphPhone(attendant.phoneE164), { kind: "free_text", text: msgLines.join("\n") });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

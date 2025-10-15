// src/lib/wa_supply_notify.ts
// Formatter & dispatcher for supply notifications with role-specific text
// and 24h session window awareness.

import { prisma } from "@/lib/prisma";
import { sendTextSafe, sendTemplate } from "@/lib/wa";

export type SupplyItem = { name: string; qty: number; unit?: string; unitPrice?: number; productKey?: string };
export type SupplyPayload = {
  outlet: string;
  ref: string;
  dateISO: string;
  supplierName: string;
  attendantName: string;
  items: SupplyItem[];
  qtyUnitDefault?: string;
  // Optional enhanced summary fields (precomputed by caller)
  openingTotalQty?: number;
  supplyTotalQty?: number;
  totalStockQty?: number;
  expectedSellPrice?: number; // per kg
  expectedTotalValue?: number;
};
export type Role = "attendant" | "supplier" | "supervisor";

const num0 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 });

function shillings(v: number) { return num0.format(Math.round(v)); }

function lineFor(item: SupplyItem, omitPrice: boolean): string {
  const unit = item.unit || "kg";
  if (omitPrice || typeof item.unitPrice !== "number") {
    return `- ${item.name}: ${num2.format(item.qty)}${unit}`;
  }
  const value = item.qty * item.unitPrice;
  return `- ${item.name}: ${num2.format(item.qty)}${unit} @ ${shillings(item.unitPrice)} = ${shillings(value)}`;
}

function sumTotals(items: SupplyItem[], defaultUnit = "kg") {
  const unit = items.find(i => i.unit)?.unit ?? defaultUnit;
  let totalQty = 0; let totalCost = 0;
  for (const it of items) {
    totalQty += it.qty;
    if (typeof it.unitPrice === "number") totalCost += it.qty * it.unitPrice;
  }
  return { totalQty, unit, totalCost };
}

function fmtDate(dateISO: string) {
  const when = new Date(dateISO);
  const date = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", year: "numeric", month: "short", day: "2-digit" }).format(when);
  const time = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(when);
  return { date, time };
}

export function formatSupplyMessage(role: Role, p: SupplyPayload): string {
  // Build item lines per role: attendants and suppliers see qty-only; supervisors see price lines
  const itemLinesQtyOnly = p.items.map(i => lineFor(i, true)).join("\n");
  const itemLinesWithPrice = p.items.map(i => lineFor(i, false)).join("\n");
  const { totalQty, unit, totalCost } = sumTotals(p.items, p.qtyUnitDefault || "kg");
  const dateObj = fmtDate(p.dateISO);
  const dateStrFull = `${dateObj.date} ${dateObj.time}`;

  if (role === "attendant") {
    const ts = fmtDate(p.dateISO);
    const openingStr = typeof p.openingTotalQty === 'number' ? `${num2.format(p.openingTotalQty)}${unit}` : undefined;
    const supplyStr = typeof p.supplyTotalQty === 'number' ? `${num2.format(p.supplyTotalQty)}${unit}` : `${num2.format(totalQty)}${unit}`;
    const totalStockStr = typeof p.totalStockQty === 'number' ? `${num2.format(p.totalStockQty)}${unit}` : undefined;
    const priceStr = typeof p.expectedSellPrice === 'number' && p.expectedSellPrice > 0 ? `Ksh ${shillings(p.expectedSellPrice)}` : undefined;
    const totalValStr = typeof p.expectedTotalValue === 'number' && p.expectedTotalValue > 0 ? `Ksh ${shillings(p.expectedTotalValue)}` : undefined;
    const lines: string[] = [
      `🧾 Supply Update — ${p.outlet}`,
      `📅 Date: ${ts.date} • ⏰ Time: ${ts.time}`,
      ``,
  `🥩 Items supplied:`,
  itemLinesQtyOnly,
    ];
    lines.push(``);
    if (openingStr) lines.push(`📦 Today’s opening stock: ${openingStr}`);
    lines.push(`➕ New supply: ${supplyStr}`);
    if (totalStockStr) lines.push(`📊 Total stock: ${totalStockStr}`);
    if (priceStr) lines.push(``, `💰 Expected price per kg: ${priceStr}`);
    if (totalValStr) lines.push(`🧮 Expected total value: ${totalValStr}`);
    lines.push(
      ``,
      `👨‍🍳 Received by: ${p.attendantName}`,
      `🚚 Supplied by: ${p.supplierName || "Kyalo"}`,
      ``,
      `⚠️ If the quantity is incorrect  login to your dashboard to raise dispute click here https://barakafresh.com/attendant or talk to supervisor`
    );
    return lines.join("\n");
  }
  if (role === "supplier") {
    return [
      `✅ Delivery Confirmed — ${p.outlet}`,
      `Date: ${dateStrFull}`,
      ``,
      `Items supplied:`,
      itemLinesQtyOnly,
      ``,
      `🧾 Total purchase amount: Ksh ${shillings(totalCost)}`,
      ``,
      `Received by: ${p.attendantName}`,
      `Reference: ${p.ref}`,
      ``,
      `Thank you. If any correction is needed, reply CORRECT: <what to fix>.`,
    ].join("\n");
  }
  return [
    `📦 Supply Alert — ${p.outlet}`,
    `Date: ${dateStrFull}`,
    ``,
    `Items:`,
    itemLinesWithPrice,
    ``,
    `Totals: ${num2.format(totalQty)}${unit} | Ksh ${shillings(totalCost)}`,
    ``,
    `Delivered by: ${p.supplierName}`,
    `Received by: ${p.attendantName}`,
    `Ref: ${p.ref}`,
    ``,
    `Note: This stock posts to OpeningEff = Yesterday Closing + Today Supply.`,
  ].join("\n");
}

// Determine if within 24h inbound window for free-text eligibility
async function hasRecentInbound(phoneE164: string): Promise<boolean> {
  try {
    const rows: any[] = await (prisma as any).$queryRaw`SELECT MAX("createdAt") AS last_in FROM "WaMessageLog" WHERE direction='in' AND (payload->'meta'->>'phoneE164' = ${phoneE164} OR payload->>'phone' = ${phoneE164})`;
    const last = rows?.[0]?.last_in ? new Date(rows[0].last_in).getTime() : 0;
    if (!last) return false;
    return Date.now() - last <= 24*60*60*1000;
  } catch { return false; }
}

export type SupplyNotifyPhones = { attendant?: string | null; supplier?: string | null; supervisor?: string | null };
export type SupplyNotifyTemplates = { attendant?: string; supplier?: string; supervisor?: string };

export async function notifySupplyMultiRole(opts: {
  payload: SupplyPayload;
  phones: SupplyNotifyPhones;
  templates?: SupplyNotifyTemplates; // fallback template names when session closed
}) {
  const { payload, phones, templates } = opts;
  const results: Record<string, any> = {};
  for (const role of ["attendant","supplier","supervisor"] as Role[]) {
    const phone = (phones as any)[role];
    if (!phone) continue;
    const text = formatSupplyMessage(role, payload);
    const windowOpen = await hasRecentInbound(phone);
    if (windowOpen) {
      results[role] = await sendTextSafe(phone, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else if (templates && (templates as any)[role]) {
      // fallback to template; map a few dynamic params (we keep it minimal)
      const tmplName = (templates as any)[role];
      try {
        const params = [payload.outlet, payload.ref];
        results[role] = await sendTemplate({ to: phone, template: tmplName, params, contextType: "TEMPLATE_REOPEN" });
      } catch (e: any) {
        results[role] = { ok: false, error: String(e?.message || e) };
      }
    } else {
      // No template configured; attempt text anyway (may fail if window closed but we log it)
      results[role] = await sendTextSafe(phone, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
  }
  return { ok: true, results };
}

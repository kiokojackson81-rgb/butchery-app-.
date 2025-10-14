import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { notifySupplyMultiRole } from "@/lib/wa_supply_notify";
import { enqueueOpsEvent } from "@/lib/opsEvents";
import { getTodaySupplySummary, SupplySummaryLine } from "@/server/supply";
import { createReviewItem } from "@/server/review";
import { format } from "date-fns";
import crypto from "crypto";

const moneyFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function money(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `KSh ${moneyFormatter.format(Math.round(value))}`;
}

function buildLines(lines: SupplySummaryLine[]): string {
  if (!lines.length) return "(no lines)";
  return lines
    .map((line) => `• ${line.name} — ${line.qty} ${line.unit} @ ${money(line.buyPrice)}`)
    .join("\n");
}


function totalBuy(lines: SupplySummaryLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.buyPrice, 0);
}

function makeId() {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
}

function uniquePhones(rows: Array<{ phoneE164: string | null }>): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const phone = row?.phoneE164;
    if (!phone) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    list.push(phone);
  }
  return list;
}

async function sendBulk(phones: string[], message: string) {
  if (!phones.length) return;
  if (process.env.WA_AUTOSEND_ENABLED === "true") {
    // old path (temporary)
  await Promise.allSettled(phones.map((phone) => sendText(phone, message, "AI_DISPATCH_TEXT", { gpt_sent: true })));
  } else {
    await Promise.allSettled(phones.map((phone) => sendOpsMessage(phone, { kind: "free_text", text: message })));
  }
}

export async function notifySupplyPosted(opts: { outletName: string; date?: string; supplierCode?: string | null }) {
  const outletName = opts.outletName.trim();
  if (!outletName) return { sent: false, reason: "no-outlet" };
  const date = opts.date || format(new Date(), "yyyy-MM-dd");
  const lines = await getTodaySupplySummary(outletName, date);
  if (!lines.length) return { sent: false, reason: "no-lines" };

  // Derive a synthetic payload for new formatter (aggregate lines into SupplyPayload shape)
  const payload = {
    outlet: outletName,
    ref: `SUP-${date}`,
    dateISO: new Date().toISOString(),
    supplierName: opts.supplierCode || "Supplier",
    attendantName: "Attendant",
    items: lines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.buyPrice })),
  };
  const attendant = await prisma.phoneMapping.findFirst({ where: { role: "attendant", outlet: outletName } });
  const supervisor = await prisma.phoneMapping.findFirst({ where: { role: "supervisor" } });
  const supplier = opts.supplierCode ? await prisma.phoneMapping.findUnique({ where: { code: opts.supplierCode } }) : null;
  const phones = { attendant: attendant?.phoneE164 || null, supervisor: supervisor?.phoneE164 || null, supplier: supplier?.phoneE164 || null };
  try {
    const res = await notifySupplyMultiRole({ payload, phones });
    await enqueueOpsEvent({ id: makeId(), type: 'SUPPLY_SUBMITTED', entityId: null, outletId: outletName, supplierId: opts.supplierCode || null, actorRole: null, dedupeKey: `SUPPLY_SUBMITTED:${outletName}:${date}` });
    return { sent: true, multiRole: res };
  } catch (e) {
    return { sent: true, degraded: true };
  }
}

export async function handleSupplyDispute(opts: {
  outletName: string;
  date?: string;
  reason: string;
  attendantPhone: string;
  attendantCode?: string | null;
}) {
  const outletName = opts.outletName.trim();
  if (!outletName) return { ok: false, reason: "no-outlet" };
  const date = opts.date || format(new Date(), "yyyy-MM-dd");
  const reason = opts.reason.trim() || "No reason provided";

  const lines = await getTodaySupplySummary(outletName, date);
  const payload = {
    reason,
    lines,
    attendantCode: opts.attendantCode || null,
    date,
  };

  await createReviewItem({ type: "supply-dispute", outlet: outletName, date: new Date(), payload });

  // Enqueue a SUPPLY_DISPUTED OpsEvent; worker will notify supervisors/admins.
  try {
    await enqueueOpsEvent({ id: makeId(), type: 'SUPPLY_DISPUTED', entityId: null, outletId: outletName, supplierId: null, actorRole: 'attendant', dedupeKey: `SUPPLY_DISPUTED:${outletName}:${date}` });
    const ack = `Dispute logged for ${outletName}. Supervisor has been notified.`;
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
      await sendText(opts.attendantPhone, ack, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      await sendOpsMessage(opts.attendantPhone, { kind: "free_text", text: ack });
    }
  } catch (e) {
    // fallback immediate notify supervisors if enqueue fails
    const supervisors = await prisma.phoneMapping.findMany({ where: { role: "supervisor" } });
    const messageSupervisor = `Dispute raised — ${outletName}\nReason: "${reason}".\nPlease review in the dashboard.`;
    await sendBulk(uniquePhones(supervisors), messageSupervisor);
    const ack = `Dispute logged for ${outletName}. Supervisor has been notified.`;
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
      await sendText(opts.attendantPhone, ack, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      await sendOpsMessage(opts.attendantPhone, { kind: "free_text", text: ack });
    }
  }

  return { ok: true };
}

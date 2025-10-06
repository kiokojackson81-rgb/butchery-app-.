import { prisma } from "@/lib/prisma";
import { sendTemplate } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { WA_TEMPLATES } from "./templates";

function todayISO(tz = process.env.TZ_DEFAULT || "Africa/Nairobi") {
  // naive: use server date; production should use a TZ lib
  return new Date().toISOString().slice(0, 10);
}

function enabled(): boolean {
  return String(process.env.REMINDERS_ENABLED || "true").toLowerCase() === "true";
}

export async function runAttendantClosingReminder() {
  if (!enabled()) return { ok: false, reason: "disabled" } as const;
  const date = todayISO();
  let count = 0;
  const list = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", phoneE164: { not: "" } } }).catch(() => []);
  for (const row of list as any[]) {
    const phone = row.phoneE164 as string; const outlet = row.outlet || "";
    // idempotency
    const dup = await (prisma as any).reminderSend.findUnique({ where: { type_phoneE164_date: { type: "attendant-21", phoneE164: phone, date } } }).catch(() => null);
    if (dup) continue;
    // pending deposits
    const agg = await (prisma as any).attendantDeposit.aggregate({ _sum: { amount: true }, where: { date, outletName: outlet, status: "PENDING" } }).catch(() => ({ _sum: { amount: 0 } }));
    const pending = Number(agg?._sum?.amount || 0);
    // skip if already closed and no pending
    const hasClosing = await (prisma as any).attendantClosing.findFirst({ where: { date, outletName: outlet } }).catch(() => null);
    if (hasClosing && pending <= 0) continue;
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
      // old path (temporary)
      const fmt = pending > 0 ? `KES ${pending.toLocaleString("en-KE")}` : "0";
      const link = (process.env.APP_ORIGIN || "") + "/login";
      try { await sendTemplate({ to: phone, template: WA_TEMPLATES.attendantClosingReminder, params: [outlet, fmt, link], contextType: "REMINDER" }); } catch {}
    } else {
      // new AI dispatcher path
      try { await sendOpsMessage(phone, { kind: "closing_reminder", outlet, pendingAmount: pending }); } catch {}
    }
    try { await (prisma as any).reminderSend.create({ data: { type: "attendant-21", phoneE164: phone, date } }); } catch {}
    count++;
  }
  return { ok: true, count } as const;
}

export async function runSupervisorReviewReminder() {
  if (!enabled()) return { ok: false, reason: "disabled" } as const;
  const date = todayISO();
  let count = 0;
  const list = await (prisma as any).phoneMapping.findMany({ where: { role: "supervisor", phoneE164: { not: "" } } }).catch(() => []);
  for (const row of list as any[]) {
    const phone = row.phoneE164 as string; const outlet = row.outlet || "";
    const dup = await (prisma as any).reminderSend.findUnique({ where: { type_phoneE164_date: { type: "supervisor-22", phoneE164: phone, date } } }).catch(() => null);
    if (dup) continue;
    // pending counts (simple: deposits pending; others zero if not tracked)
    const depCount = await (prisma as any).attendantDeposit.count({ where: { date, outletName: outlet, status: "PENDING" } }).catch(() => 0);
    const expCount = 0; // if expense approvals exist, compute here
    const closingCount = await (prisma as any).attendantClosing.count({ where: { date, outletName: outlet } }).catch(() => 0);
    const total = depCount + expCount + closingCount;
    if (total <= 0) continue;
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
      const link = (process.env.APP_ORIGIN || "") + "/login";
      try { await sendTemplate({ to: phone, template: WA_TEMPLATES.supervisorReviewReminder, params: [outlet, String(closingCount), String(depCount), String(expCount), link], contextType: "REMINDER" }); } catch {}
    } else {
      try { await sendOpsMessage(phone, { kind: "free_text", text: `Reminder: Review today for ${outlet}. Closings: ${closingCount}, Deposits pending: ${depCount}.` }); } catch {}
    }
    try { await (prisma as any).reminderSend.create({ data: { type: "supervisor-22", phoneE164: phone, date } }); } catch {}
    count++;
  }
  return { ok: true, count } as const;
}

export async function runSupplierOpeningReminder() {
  if (!enabled()) return { ok: false, reason: "disabled" } as const;
  const date = todayISO();
  let count = 0;
  const list = await (prisma as any).phoneMapping.findMany({ where: { role: "supplier", phoneE164: { not: "" } } }).catch(() => []);
  for (const row of list as any[]) {
    const phone = row.phoneE164 as string; const outlet = row.outlet || "";
    const dup = await (prisma as any).reminderSend.findUnique({ where: { type_phoneE164_date: { type: "supplier-0630", phoneE164: phone, date } } }).catch(() => null);
    if (dup) continue;
    const existing = await (prisma as any).supplyOpeningRow.findFirst({ where: { date, outletName: outlet } }).catch(() => null);
    if (existing) continue;
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
      const link = (process.env.APP_ORIGIN || "") + "/login";
      try { await sendTemplate({ to: phone, template: WA_TEMPLATES.supplierOpeningReminder, params: [outlet, date, link], contextType: "REMINDER" }); } catch {}
    } else {
      try { await sendOpsMessage(phone, { kind: "free_text", text: `Good morning! Submit today’s supply for ${outlet}.` }); } catch {}
    }
    try { await (prisma as any).reminderSend.create({ data: { type: "supplier-0630", phoneE164: phone, date } }); } catch {}
    count++;
  }
  return { ok: true, count } as const;
}

// src/server/trading_period.ts
// Trading Period helpers (per outlet + date) without new DB tables.
// Uses Setting keys to represent locks and derives activity from existing rows.

import { prisma } from "@/lib/prisma";

export type PeriodState = "OPEN" | "LOCKED";

export function todayLocalISO(d: Date = new Date()) {
  // Use server local date (calendar day) per spec
  return d.toISOString().slice(0, 10);
}

const lockKey = (date: string, outlet: string) => `lock:attendant:${date}:${outlet}`;

export async function isPeriodLocked(outlet: string, date = todayLocalISO()): Promise<boolean> {
  const row = await (prisma as any).setting.findUnique({ where: { key: lockKey(date, outlet) } }).catch(() => null);
  return Boolean(row?.value?.locked);
}

export async function getPeriodState(outlet: string, date = todayLocalISO()): Promise<PeriodState> {
  return (await isPeriodLocked(outlet, date)) ? "LOCKED" : "OPEN";
}

export async function lockPeriod(outlet: string, date = todayLocalISO(), by?: string) {
  const key = lockKey(date, outlet);
  const value = { locked: true, lockedAt: new Date().toISOString(), by: by || "system" };
  await (prisma as any).setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// Count of products considered "active" for today at outlet:
// active = products configured for outlet (PricebookRow.active) minus already-closed rows for date.
export async function countActiveProducts(outlet: string, date = todayLocalISO()): Promise<{ total: number; closed: number; active: number }> {
  const [pricebook, closedRows] = await Promise.all([
    (prisma as any).pricebookRow.findMany({ where: { outletName: outlet, active: true }, select: { productKey: true } }),
    (prisma as any).attendantClosing.findMany({ where: { outletName: outlet, date }, select: { itemKey: true } }),
  ]);
  const totalSet = new Set<string>((pricebook || []).map((r: any) => r.productKey));
  const closedSet = new Set<string>((closedRows || []).map((r: any) => r.itemKey));
  const total = totalSet.size;
  const closed = Array.from(closedSet).filter((k) => totalSet.has(k)).length;
  const active = Math.max(0, total - closed);
  return { total, closed, active };
}

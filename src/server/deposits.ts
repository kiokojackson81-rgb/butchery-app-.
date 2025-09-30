// src/server/deposits.ts
import { prisma } from "@/lib/db";

export function parseMpesaText(s: string): { amount: number; ref: string; at: Date } | null {
  const m = /Ksh\s*([0-9,]+)\b.*?([A-Z0-9]{10,})/i.exec(s);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  const ref = m[2];
  return { amount, ref, at: new Date() };
}

export async function addDeposit(args: { date?: string; outletName: string; amount: number; note?: string; code?: string }) {
  const date = args.date || new Date().toISOString().slice(0, 10);
  await (prisma as any).attendantDeposit.create({ data: { date, outletName: args.outletName, amount: args.amount, note: args.note || null, status: "PENDING", createdAt: new Date() } });
}

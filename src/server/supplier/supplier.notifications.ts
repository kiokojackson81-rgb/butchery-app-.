// src/server/supplier/supplier.notifications.ts
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";

function toGraph(noPlus: string | null | undefined) {
  if (!noPlus) return "";
  return noPlus.replace(/^\+/, "");
}

async function phonesForOutlet(outlet: string, roles: ("attendant" | "supervisor")[]) {
  const rows = await (prisma as any).phoneMapping.findMany({
    where: {
      role: { in: roles as any },
      outlet: outlet,
      phoneE164: { not: null },
    },
  });
  return rows.map((r: any) => toGraph(r.phoneE164!)).filter(Boolean);
}

export async function notifyOpeningLocked(outlet: string, date: string, summaryLine: string) {
  const tos = await phonesForOutlet(outlet, ["attendant", "supervisor"]);
  const body = `Opening stock locked for ${outlet} on ${date}:\n${summaryLine}`;
  await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: body })));
}

export async function notifyTransferCreated(fromOutlet: string, toOutlet: string, date: string, desc: string) {
  const tosFrom = await phonesForOutlet(fromOutlet, ["attendant", "supervisor"]);
  const tosTo = await phonesForOutlet(toOutlet, ["attendant", "supervisor"]);
  const msg = `Transfer on ${date}: ${desc}`;
  await Promise.all([...new Set([...tosFrom, ...tosTo])].map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
}

export async function notifySupervisorDispute(outlet: string, date: string, desc: string) {
  const tos = await phonesForOutlet(outlet, ["supervisor"]);
  const msg = `Dispute filed (${outlet} • ${date}): ${desc}`;
  await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
}

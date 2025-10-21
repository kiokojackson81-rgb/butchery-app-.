// src/server/supervisor/supervisor.notifications.ts
import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";

function toGraph(plus?: string | null) {
  return (plus || "").replace(/^\+/, "");
}

async function phonesByCode(code?: string | null) {
  if (!code) return [] as string[];
  const row = await (prisma as any).phoneMapping.findUnique({ where: { code } });
  return row?.phoneE164 ? [toGraph(row.phoneE164)] : [];
}

async function phoneAttendants(outlet: string) {
  const rows = await (prisma as any).phoneMapping.findMany({ where: { outlet, role: "attendant", phoneE164: { not: null } } });
  return rows.map((r: any) => toGraph(r.phoneE164!)).filter(Boolean);
}

export async function notifyOriginator(item: any, msg: string) {
  const origin = (item?.payload as any)?.by as string | undefined;
  const tos = (await phonesByCode(origin)) as string[];
  if (!tos.length) return;
  await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
}

export async function notifyAttendants(outlet: string, msg: string) {
  const tos = (await phoneAttendants(outlet)) as string[];
  if (!tos.length) return;
  await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
}

export async function notifySupplier(outlet: string, msg: string) {
  const rows = await (prisma as any).phoneMapping.findMany({ where: { outlet, role: "supplier", phoneE164: { not: null } } });
  const tos = rows.map((r: any) => toGraph(r.phoneE164!)).filter(Boolean) as string[];
  if (!tos.length) return;
  await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
}

// Notify supervisors and admins (by role) for an outlet
export async function notifySupervisorsAndAdmins(outlet: string, msg: string) {
  try {
    const rows = await (prisma as any).phoneMapping.findMany({ where: { outlet, role: { in: ["supervisor", "admin"] }, phoneE164: { not: null } } });
    const tos = rows.map((r: any) => toGraph(r.phoneE164!)).filter(Boolean) as string[];
    if (!tos.length) return;
    await Promise.all(tos.map((to: string) => sendOpsMessage(to, { kind: "free_text", text: msg })));
  } catch (e) {
    // best-effort
  }
}

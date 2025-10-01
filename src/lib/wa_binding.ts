import { prisma } from "@/lib/prisma";
import { normalizeToPlusE164 } from "@/lib/wa_phone";
import { sendAttendantMenu, sendSupplierMenu, sendSupervisorMenu } from "@/lib/wa_menus";
import { sendText } from "@/lib/wa";

export async function tryBindViaLinkToken(fromGraphNoPlus: string, text: string) {
  if (!/^LINK\s+\d{6}$/i.test(String(text || "").trim())) return false;

  const phonePlus = normalizeToPlusE164(fromGraphNoPlus); // +2547...

  // Find a pending session with this token
  const token = String(text).trim().toUpperCase();
  const pending = await (prisma as any).waSession.findFirst({
    where: {
      phoneE164: { startsWith: "+PENDING:" },
      state: "LOGIN",
      cursor: { path: ["linkToken"], equals: token },
    },
  });

  if (!pending) {
    await sendText(fromGraphNoPlus, "Link code not found or expired. Please retry from https://barakafresh.com/login");
    return true; // handled
  }

  // Token freshness (10 minutes)
  const issued = Number((pending as any)?.cursor?.issuedAt || 0);
  if (!issued || Date.now() - issued > 10 * 60_000) {
    await sendText(fromGraphNoPlus, "This link code has expired. Please login again at https://barakafresh.com/login");
    await (prisma as any).waSession.delete({ where: { id: pending.id } }).catch(() => {});
    return true;
  }

  // Enforce safe binding: if code already bound to another phone, block
  const existing = await (prisma as any).phoneMapping.findUnique({ where: { code: pending.code } });
  if (existing?.phoneE164 && existing.phoneE164 !== phonePlus) {
    await sendText(fromGraphNoPlus, "This code is already linked to another phone. Contact your supervisor.");
    await (prisma as any).waSession.delete({ where: { id: pending.id } }).catch(() => {});
    return true;
  }

  // Bind phone -> code
  await (prisma as any).phoneMapping.upsert({
    where: { code: pending.code },
    update: { role: pending.role, phoneE164: phonePlus, outlet: pending.outlet ?? existing?.outlet ?? null },
    create: { code: pending.code, role: pending.role, phoneE164: phonePlus, outlet: pending.outlet ?? null },
  });

  // Move to MENU and send role menu
  await (prisma as any).waSession.upsert({
    where: { phoneE164: phonePlus },
    update: { role: pending.role, code: pending.code, outlet: pending.outlet, state: "MENU", cursor: { date: new Date().toISOString().slice(0, 10), rows: [] } },
    create: { phoneE164: phonePlus, role: pending.role, code: pending.code, outlet: pending.outlet, state: "MENU", cursor: { date: new Date().toISOString().slice(0, 10), rows: [] } },
  });

  // Clean pending
  await (prisma as any).waSession.delete({ where: { id: pending.id } }).catch(() => {});

  if (pending.role === "attendant") await sendAttendantMenu(fromGraphNoPlus, pending.outlet || "your outlet");
  else if (pending.role === "supplier") await sendSupplierMenu(fromGraphNoPlus);
  else await sendSupervisorMenu(fromGraphNoPlus);

  return true;
}

// src/lib/resolveAssignment.ts
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "./normalizeCode";

export async function resolveAssignment(raw: string) {
  const code = normalizeCode(raw);
  if (!code) return null;
  // Primary: AttendantAssignment in DB
  try {
    const aa = await (prisma as any).attendantAssignment.findFirst({ where: { code } });
    if (aa) return { outlet: aa.outlet as string, productKeys: (aa.productKeys as string[]) ?? [] };
  } catch {}

  // Legacy fallbacks (kept as comments to preserve behavior if any existed)
  // TODO: If you had fallback to settings/admin_* maps, it can be implemented here without changing shapes.

  return null;
}

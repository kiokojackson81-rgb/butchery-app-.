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

  // Fallback A: settings-backed attendant scope map
  try {
    const setting = await (prisma as any).setting.findUnique({ where: { key: "attendant_scope" } });
    const map = (setting?.value ?? {}) as Record<string, { outlet: string; productKeys?: string[] }>;
    const hit = map[code] || map[normalizeCode(code)];
    if (hit && hit.outlet) {
      return { outlet: hit.outlet, productKeys: hit.productKeys ?? [] };
    }
  } catch {}

  // Fallback B: settings-backed admin_codes (role=attendant)
  try {
    const setting = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const arr = Array.isArray(setting?.value) ? (setting!.value as any[]) : [];
    const found = arr.find((r) => normalizeCode(r?.code || "") === code && (r?.role === "attendant" || !r?.role));
    if (found?.outlet) {
      // When only outlet is available in admin_codes, default product keys to empty
      return { outlet: found.outlet as string, productKeys: Array.isArray(found.productKeys) ? found.productKeys : [] };
    }
  } catch {}

  return null;
}

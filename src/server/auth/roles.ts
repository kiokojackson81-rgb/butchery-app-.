// src/server/auth/roles.ts
import { prisma } from "@/lib/db";

function norm(s: string) {
  return (s || "").toString().replace(/\s+/g, "").trim().toLowerCase();
}

export async function validateActorCode(role: "supplier" | "supervisor", code?: string | null) {
  if (!code) return null;
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
    const list = Array.isArray((row as any)?.value) ? (row as any).value : [];
    const n = norm(code);
    const found = list.find((p: any) => {
      const r = (p?.role || "").toString().toLowerCase();
      const active = !!p?.active;
      const c = (p?.code || "").toString();
      return active && r === role && norm(c) === n;
    });
    return found?.code || null;
  } catch {
    return null;
  }
}

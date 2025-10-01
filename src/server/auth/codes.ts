import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "@/lib/codeNormalize";

type Role = "attendant" | "supervisor" | "supplier";

export async function findActiveCode(role: Role, raw: string) {
  const full = canonFull(raw);
  if (!full) return { ok: false as const, reason: "empty" };

  // Try full first
  try {
    const pcFull = await (prisma as any).personCode.findUnique({ where: { code: full } });
    if (pcFull && pcFull.active && pcFull.role === role) {
      return { ok: true as const, code: pcFull.code, person: pcFull };
    }
  } catch {}

  // Try digits-only if full not found
  const num = canonNum(raw);
  if (!num) return { ok: false as const, reason: "not_found" };

  let candidates: Array<{ code: string; name?: string | null }> = [];
  try {
    candidates = await (prisma as any).personCode.findMany({
      where: { role, active: true },
      select: { code: true, name: true },
      take: 200,
    });
  } catch {}

  const matches = candidates.filter((c) => canonNum(c.code) === num);
  if (matches.length === 1) {
    const code = matches[0].code;
    const p = await (prisma as any).personCode.findUnique({ where: { code } });
    if (p && p.active && p.role === role) return { ok: true as const, code, person: p };
  }
  if (matches.length > 1) return { ok: false as const, reason: "ambiguous" };
  return { ok: false as const, reason: "not_found" };
}

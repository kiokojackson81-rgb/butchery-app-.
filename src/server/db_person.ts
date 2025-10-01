// src/server/db_person.ts
// Tolerant PersonCode lookup used by login finalization and other flows.
import { prisma } from "@/lib/prisma";
import { canonFull, canonNum } from "./canon";

export async function findPersonCodeTolerant(raw: string) {
  const full = canonFull(raw);
  if (!full) return null;

  try {
    const pcFull = await (prisma as any).personCode.findFirst({ where: { code: full, active: true } });
    if (pcFull) return pcFull;
  } catch {}

  const digits = canonNum(raw);
  if (digits.length < 3) return null;

  let all: Array<{ code: string; active: boolean }> = [];
  try {
    all = await (prisma as any).personCode.findMany({ where: { active: true }, select: { code: true, active: true }, take: 500 });
  } catch {}

  const hits = all.filter((x) => canonNum(x.code) === digits);
  if (hits.length === 1) {
    const only = hits[0];
    const pc = await (prisma as any).personCode.findFirst({ where: { code: only.code, active: true } });
    return pc || null;
  }
  if (hits.length > 1) throw new Error("ambiguous");
  return null;
}

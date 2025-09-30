// src/server/supervisor/rules.service.ts
import { prisma } from "@/lib/db";
import { ZRules, ZRulesUpdate } from "./supervisor.validation";

const KEY = "supervisor:rules";

export async function getRules() {
  const s = await (prisma as any).setting.findUnique({ where: { key: KEY } });
  if (!s) return ZRules.parse({});
  try {
    return ZRules.parse(s.value);
  } catch {
    return ZRules.parse({});
  }
}

export async function setRules(partial: unknown) {
  const merged = { ...(await getRules()), ...ZRulesUpdate.parse(partial) } as any;
  const out = await (prisma as any).setting.upsert({
    where: { key: KEY },
    update: { value: merged },
    create: { key: KEY, value: merged },
  });
  return out.value;
}

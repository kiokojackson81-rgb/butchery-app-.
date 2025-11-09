import { prisma } from "@/lib/prisma";

// Lightweight helper to check if an attendant is in the special allow-list
// Source of truth: Setting key "general_deposit_attendants" -> JSON array of codes (strings)
// Optional fallback: env GENERAL_DEPOSIT_ATTENDANTS="CODE1,CODE2"

const CACHE_TTL_MS = 60_000; // 1 minute cache
let cache: { at: number; set: Set<string> } | null = null;

async function loadAllowlist(): Promise<Set<string>> {
  // Cache to reduce DB traffic
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.set;
  let arr: string[] = [];
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: "general_deposit_attendants" } });
    if (row && row.value && Array.isArray(row.value)) arr = row.value as string[];
    else if (row && row.value && Array.isArray((row.value as any).codes)) arr = ((row.value as any).codes as string[]);
  } catch {}
  if (arr.length === 0) {
    const env = process.env.GENERAL_DEPOSIT_ATTENDANTS || "";
    if (env.trim()) arr = env.split(/[;,\s]+/).filter(Boolean);
  }
  const set = new Set(arr.map((s) => String(s).trim().toUpperCase()));
  cache = { at: now, set };
  return set;
}

export async function isGeneralDepositAttendant(code?: string | null): Promise<boolean> {
  if (!code) return false;
  const set = await loadAllowlist();
  return set.has(String(code).trim().toUpperCase());
}

export async function getGeneralDepositList(): Promise<string[]> {
  const set = await loadAllowlist();
  return Array.from(set);
}

import { readJSON as safeReadJSON, writeJSON as safeWriteJSON } from "@/utils/safeStorage";

const KEYS = [
  "admin_outlets",
  "admin_products",
  "admin_expenses",
  "admin_codes",
  "attendant_scope",
  "admin_pricebook",
] as const;

export type KnownKey = typeof KEYS[number];

async function fetchSetting(key: KnownKey) {
  const r = await fetch(`/api/settings/${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.value ?? null;
}

/** DB → localStorage (call once on mount in pages that need it) */
export async function hydrateLocalStorageFromDB(keys: KnownKey[] = KEYS as any) {
  for (const key of keys) {
    try {
      const value = await fetchSetting(key as KnownKey);
      if (value !== null && value !== undefined) {
        // SSR-safe write
        safeWriteJSON(key as string, value);
      }
    } catch {}
  }
}

/** localStorage → DB (call inside your existing Save handlers) */
export async function pushLocalStorageKeyToDB(key: KnownKey) {
  try {
    const value = safeReadJSON<any>(key as string, null);
    await fetch(`/api/settings/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  } catch {}
}

/** Helper to push multiple keys if you need it */
export async function pushAllToDB(keys: KnownKey[] = KEYS as any) {
  for (const key of keys) await pushLocalStorageKeyToDB(key as KnownKey);
}

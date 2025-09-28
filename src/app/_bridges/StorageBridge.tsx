"use client";

import { useEffect } from "react";

const DB_KEYS = [
  "attendant_code",
  "admin_outlets",
  "admin_products",
  "admin_pricebook",
  "attendant_scope",
  "attendant_waste_reviews",
  "attendant_expenses_reviews",
  "excess_adjustments_reviews",
  "deficit_disputes_reviews",
  "supplier_opening_",
  "supplier_opening_full_",
  "supplier_cost_",
  "supplier_submitted_",
  "supplier_transfers_",
  "attendant_closing_",
  "attendant_waste_",
  "attendant_deposits_",
  "attendant_expenses_",
  "attendant_tillcount_",
  "attendant_summary_",
];

function shouldDBPersist(key: string) {
  return DB_KEYS.some((prefix) => key === prefix || key.startsWith(prefix));
}

async function dbGet(keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const res = await fetch("/api/state/bulk-get", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ keys }),
  });
  const js = await res.json().catch(() => null);
  const out: Record<string, string | null> = {};
  if (js?.ok && js?.data) {
    for (const k of keys) {
      out[k] = js.data[k] != null ? JSON.stringify(js.data[k]) : null;
    }
  } else {
    for (const k of keys) out[k] = null;
  }
  return out;
}

async function dbSet(items: Array<{ key: string; value: string | null }>) {
  const payload = items
    .filter((i) => shouldDBPersist(i.key))
    .map((i) => ({ key: i.key, value: i.value ? JSON.parse(i.value) : null }));
  if (payload.length === 0) return;
  await fetch("/api/state/bulk-set", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ items: payload }),
  }).catch(() => {});
}

export default function StorageBridge() {
  useEffect(() => {
    const ls = window.localStorage;
    const originalGetItem = ls.getItem.bind(ls);
    const originalSetItem = ls.setItem.bind(ls);
    const originalRemoveItem = ls.removeItem.bind(ls);

    const inFlight = new Map<string, Promise<string | null>>();
    const dbCache = new Map<string, string | null>();

    // Patch getItem: initiate DB hydrate for DB-backed keys
    ls.getItem = (key: string): string | null => {
      if (!shouldDBPersist(key)) return originalGetItem(key);
      if (dbCache.has(key)) return dbCache.get(key) ?? null;
      if (!inFlight.has(key)) {
        const p = dbGet([key]).then((map) => {
          const v = map[key] ?? null;
          dbCache.set(key, v);
          if (v == null) {
            try { originalRemoveItem(key); } catch {}
            return null;
          } else {
            try { originalSetItem(key, v); } catch {}
            return v;
          }
        });
        inFlight.set(key, p);
      }
      return originalGetItem(key);
    };

    // Patch setItem: write-through to DB
    ls.setItem = (key: string, value: string) => {
      if (shouldDBPersist(key)) {
        dbCache.set(key, value);
        dbSet([{ key, value }]).catch(() => {});
      }
      return originalSetItem(key, value);
    };

    // Patch removeItem: write-through delete to DB
    ls.removeItem = (key: string) => {
      if (shouldDBPersist(key)) {
        dbCache.set(key, null);
        dbSet([{ key, value: null }]).catch(() => {});
      }
      return originalRemoveItem(key);
    };

    return () => {
      ls.getItem = originalGetItem;
      ls.setItem = originalSetItem;
      ls.removeItem = originalRemoveItem;
    };
  }, []);

  return null;
}

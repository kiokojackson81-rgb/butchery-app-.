"use client";

import { useEffect } from "react";

const DB_KEYS = [
  "attendant_code",
  "admin_outlets",
  "admin_products",
  "admin_pricebook",
  "admin_pricebook_",
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
    const coalescedWrites = new Map<string, string | null>();

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
        const isEmptyLike = (v: string) => {
          const t = (v ?? "").trim();
          return t === "" || t === "null" || t === "{}" || t === "[]";
        };
        if (inFlight.has(key) && isEmptyLike(value)) {
          // Coalesce: delay writing empty initializer until hydration completes
          coalescedWrites.set(key, value);
          const p = inFlight.get(key)!;
          p.finally(() => {
            const latest = coalescedWrites.get(key) ?? value;
            coalescedWrites.delete(key);
            dbSet([{ key, value: latest }]).catch(() => {});
          });
        } else {
          dbSet([{ key, value }]).catch(() => {});
        }
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

  // Also persist a small whitelist of sessionStorage keys across devices.
  // These are simple string values (not JSON) used by existing pages.
  useEffect(() => {
    const ss = window.sessionStorage;
    const originalGetItem = ss.getItem.bind(ss);
    const originalSetItem = ss.setItem.bind(ss);
    const originalRemoveItem = ss.removeItem.bind(ss);

    const SESSION_DB_KEYS = [
      // exact keys
      "admin_auth",
      "admin_welcome",
      "attendant_code",
      "supervisor_code",
      "supervisor_name",
      "supplier_code",
      "supplier_name",
    ];
    const SESSION_PREFIXES = [
      // future-proof: any new supervisor_/supplier_/admin_ flags
      "supervisor_",
      "supplier_",
      "admin_",
    ];

    function shouldDBPersistSession(key: string) {
      return (
        SESSION_DB_KEYS.includes(key) ||
        SESSION_PREFIXES.some((p) => key.startsWith(p))
      );
    }

    async function dbGetStrings(keys: string[]): Promise<Record<string, string | null>> {
      if (keys.length === 0) return {};
      const res = await fetch("/api/state/bulk-get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ keys }),
      });
      const js = await res.json().catch(() => null as any);
      const map: Record<string, string | null> = {};
      if (js?.ok && js?.data) {
        for (const k of keys) {
          const v = js.data[k];
          // We store plain strings; coerce others to string if needed
          map[k] = v == null ? null : typeof v === "string" ? v : String(v);
        }
      } else {
        for (const k of keys) map[k] = null;
      }
      return map;
    }

    async function dbSetStrings(items: Array<{ key: string; value: string | null }>) {
      const payload = items.filter((i) => shouldDBPersistSession(i.key));
      if (payload.length === 0) return;
      await fetch("/api/state/bulk-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ items: payload }),
      }).catch(() => {});
    }

    const inFlight = new Map<string, Promise<string | null>>();
    const dbCache = new Map<string, string | null>();
  const coalescedWrites = new Map<string, string | null>();

    // Patch getItem: hydrate from DB on first access
    ss.getItem = (key: string): string | null => {
      if (!shouldDBPersistSession(key)) return originalGetItem(key);
      if (dbCache.has(key)) return dbCache.get(key) ?? null;
      if (!inFlight.has(key)) {
        const p = dbGetStrings([key]).then((map) => {
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
    ss.setItem = (key: string, value: string) => {
      if (shouldDBPersistSession(key)) {
        dbCache.set(key, value);
        const isEmptyLike = (v: string) => (v ?? "").trim() === "";
        if (inFlight.has(key) && isEmptyLike(value)) {
          // Coalesce empty initializer while hydration is pending
          coalescedWrites.set(key, value);
          const p = inFlight.get(key)!;
          p.finally(() => {
            const latest = coalescedWrites.get(key) ?? value;
            coalescedWrites.delete(key);
            dbSetStrings([{ key, value: latest }]).catch(() => {});
          });
        } else {
          dbSetStrings([{ key, value }]).catch(() => {});
        }
      }
      return originalSetItem(key, value);
    };

    // Patch removeItem: delete in DB
    ss.removeItem = (key: string) => {
      if (shouldDBPersistSession(key)) {
        dbCache.set(key, null);
        dbSetStrings([{ key, value: null }]).catch(() => {});
      }
      return originalRemoveItem(key);
    };

    return () => {
      ss.getItem = originalGetItem;
      ss.setItem = originalSetItem;
      ss.removeItem = originalRemoveItem;
    };
  }, []);

  // Proactive hydrate: prefetch today/outlet keys early to minimize first read latency
  useEffect(() => {
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" });
        if (!me.ok) return;
        const j = await me.json().catch(() => null as any);
        const outlet: string | null = j?.outletCode ?? j?.outlet?.code ?? null;
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const dateKey = `${yyyy}-${mm}-${dd}`;
        const keys: string[] = [];

        if (outlet) {
          keys.push(
            `supplier_opening_${dateKey}_${outlet}`,
            `supplier_opening_full_${dateKey}_${outlet}`,
            `supplier_cost_${dateKey}_${outlet}`,
            `supplier_transfers_${dateKey}_${outlet}`,
            `supplier_submitted_${dateKey}_${outlet}`,
            `attendant_closing_${dateKey}_${outlet}`,
            `attendant_waste_${dateKey}_${outlet}`,
            `attendant_deposits_${dateKey}_${outlet}`,
            `attendant_expenses_${dateKey}_${outlet}`,
            `attendant_tillcount_${dateKey}_${outlet}`,
            `attendant_summary_${dateKey}_${outlet}`,
            `admin_pricebook_${outlet}`
          );
        }

        // Common admin keys
        keys.push("admin_outlets", "admin_products", "admin_pricebook", "attendant_code");

        // De-dup and limit to persisted keys only
        const unique = Array.from(new Set(keys)).filter((k) => shouldDBPersist(k));
        if (unique.length === 0) return;
        const map = await dbGet(unique);
        for (const k of unique) {
          const v = map[k];
          if (v == null) {
            try { window.localStorage.removeItem(k); } catch {}
          } else {
            try { window.localStorage.setItem(k, v); } catch {}
          }
        }
      } catch {}
    })();
  }, []);

  return null;
}

// src/utils/devtools.ts
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON, removeItem as safeRemoveItem } from "@/utils/safeStorage";

function collectAllStorage(): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  if (typeof window === "undefined") return all;
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)!;
    const v = window.localStorage.getItem(k);
    try {
      all[k] = v === null ? null : JSON.parse(v);
    } catch {
      all[k] = v;
    }
  }
  return all;
}

export function exportJSON(): string {
  const data = collectAllStorage();
  const json = JSON.stringify(data, null, 2);
  try { void navigator.clipboard?.writeText(json); } catch {}
  return json;
}

export function importJSON(payload: string): void {
  const data = JSON.parse(payload) as Record<string, unknown>;
  Object.entries(data).forEach(([k, v]) => {
    try { safeWriteJSON(k, typeof v === "string" ? (v as any) : v); } catch {}
  });
}

export function clearAll(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.clear(); } catch {}
}

export function resetDefaults(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.clear(); } catch {}
  try { safeWriteJSON("admin_outlets", []); } catch {}
  try { safeWriteJSON("admin_products", []); } catch {}
  try { safeWriteJSON("admin_expenses", []); } catch {}
  try { safeWriteJSON("admin_codes", {} as any); } catch {}
  try { safeWriteJSON("attendant_scope", {} as any); } catch {}
  try { safeWriteJSON("admin_pricebook", {} as any); } catch {}
}

// src/utils/devtools.ts

function collectAllStorage(): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    const v = localStorage.getItem(k);
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
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  });
}

export function clearAll(): void {
  // Dev-only: wipes ALL localStorage keys
  localStorage.clear();
}

export function resetDefaults(): void {
  // Wipe then seed minimal app defaults (adjust to your app)
  localStorage.clear();
  localStorage.setItem("admin_outlets", JSON.stringify([]));
  localStorage.setItem("admin_products", JSON.stringify([]));
  localStorage.setItem("admin_expenses", JSON.stringify([]));
  localStorage.setItem("admin_codes", JSON.stringify({}));
  localStorage.setItem("attendant_scope", JSON.stringify({}));
  localStorage.setItem("admin_pricebook", JSON.stringify({}));
}

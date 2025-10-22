// Lightweight in-memory session store for DRY/dev mode when DB is unavailable.
// Not for production use. Helps Playwright tests assert session state.

export type DrySess = {
  phoneE164: string;
  state: string;
  role: string;
  outlet?: string | null;
  code?: string | null;
  cursor?: Record<string, any> | null;
};

export type DryDeposit = {
  outletName: string;
  date: string;
  amount: number;
  note?: string;
  status?: string; // e.g., "RECORDED"
  createdAt: string;
  id?: string;
};

function getStore(): Map<string, DrySess> {
  const g = globalThis as any;
  if (!g.__DRY_WA_STORE) {
    g.__DRY_WA_STORE = new Map<string, DrySess>();
  }
  return g.__DRY_WA_STORE as Map<string, DrySess>;
}

function getDepositStore(): Map<string, DryDeposit[]> {
  const g = globalThis as any;
  if (!g.__DRY_DEPOSITS) {
    g.__DRY_DEPOSITS = new Map<string, DryDeposit[]>();
  }
  return g.__DRY_DEPOSITS as Map<string, DryDeposit[]>;
}

export function getDrySession(phoneE164: string): DrySess | null {
  try {
  return getStore().get(normalize(phoneE164)) || null;
  } catch {
    return null;
  }
}

export function setDrySession(sess: DrySess) {
  try {
  getStore().set(normalize(sess.phoneE164), { ...sess });
  } catch {}
}

export function updateDrySession(phoneE164: string, patch: Partial<DrySess>) {
  try {
  const key = normalize(phoneE164);
  const store = getStore();
  const prev = store.get(key) || { phoneE164: key, state: "MENU", role: "attendant", outlet: "TestOutlet", code: "ATT001", cursor: {} };
    const next: DrySess = { ...prev, ...patch, phoneE164: key } as DrySess;
    store.set(key, next);
  } catch {}
}

function normalize(p: string): string {
  const s = String(p || "").replace(/[^0-9+]/g, "");
  return s.startsWith("+") ? s : "+" + s;
}

// --- DRY deposits helpers ---
export function recordDryDeposit(row: { outletName: string; date: string; amount: number; note?: string }) {
  try {
    const key = `${row.outletName}@@${row.date}`;
    const store = getDepositStore();
    const list = store.get(key) || [];
    const id = `dry:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
    const item: DryDeposit = { outletName: row.outletName, date: row.date, amount: row.amount, note: row.note, status: "RECORDED", createdAt: new Date().toISOString(), id };
    list.unshift(item);
    store.set(key, list.slice(0, 50)); // keep last 50
    return item;
  } catch {}
}

export function listDryDeposits(outletName: string, date: string, limit = 10): DryDeposit[] {
  try {
    const key = `${outletName}@@${date}`;
    const store = getDepositStore();
    const list = store.get(key) || [];
    return list.slice(0, limit);
  } catch { return []; }
}

export function getDryDepositById(id: string): DryDeposit | null {
  try {
    const store = getDepositStore();
    for (const [k, list] of store.entries()) {
      for (const it of list) {
        if (it.id === id) return it;
      }
    }
    return null;
  } catch { return null; }
}

export function updateDryDeposit(id: string, patch: Partial<DryDeposit>): DryDeposit | null {
  try {
    const store = getDepositStore();
    for (const [k, list] of store.entries()) {
      const idx = list.findIndex((it) => it.id === id);
      if (idx >= 0) {
        const existing = list[idx];
        const updated = { ...existing, ...patch };
        list[idx] = updated;
        store.set(k, list);
        return updated;
      }
    }
    return null;
  } catch { return null; }
}

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

function getStore(): Map<string, DrySess> {
  const g = globalThis as any;
  if (!g.__DRY_WA_STORE) {
    g.__DRY_WA_STORE = new Map<string, DrySess>();
  }
  return g.__DRY_WA_STORE as Map<string, DrySess>;
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

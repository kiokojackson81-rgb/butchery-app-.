// In-memory WA message log store used for DRY/dev mode so tests can inspect logs
export type DevWaLogRow = {
  id: string;
  createdAt: string;
  direction?: string | null;
  templateName?: string | null;
  status?: string | null;
  waMessageId?: string | null;
  payload: any;
};

function getStore(): DevWaLogRow[] {
  const g = globalThis as any;
  if (!g.__DEV_WA_LOGS) g.__DEV_WA_LOGS = [] as DevWaLogRow[];
  return g.__DEV_WA_LOGS as DevWaLogRow[];
}

export function addDevWaLog(row: Partial<DevWaLogRow>) {
  try {
    const id = `devlog-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const createdAt = new Date().toISOString();
    const next: DevWaLogRow = { id, createdAt, direction: row.direction || 'out', templateName: row.templateName || null, status: row.status || null, waMessageId: row.waMessageId || null, payload: row.payload || {} };
    const store = getStore();
    store.unshift(next);
    // keep reasonable cap
    if (store.length > 1000) store.length = 1000;
    return next;
  } catch {
    return null as any;
  }
}

export function queryDevWaLogs(opts: { to?: string; q?: string; limit?: number }) {
  try {
    const store = getStore();
    let list = store.slice();
    const to = opts.to ? opts.to.replace(/^\+/, '') : undefined;
    if (to) {
      list = list.filter((r) => {
        try {
          const p = r.payload || {};
          const metaPhone = p?.meta?.phoneE164 || p?.phone || p?.request?.to || p?.to || null;
          if (!metaPhone) return false;
          const num = String(metaPhone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
          return num === to;
        } catch { return false; }
      });
    }
    if (opts.q) {
      const q = String(opts.q || '').toLowerCase();
      list = list.filter((r) => (String(r.templateName || '') + ' ' + String(r.status || '') + ' ' + JSON.stringify(r.payload || '')).toLowerCase().includes(q));
    }
    return list.slice(0, Math.max(1, Math.min(200, opts.limit || 50)));
  } catch {
    return [] as DevWaLogRow[];
  }
}

export function clearDevWaLogs() { try { const g = globalThis as any; if (g && g.__DEV_WA_LOGS) g.__DEV_WA_LOGS = []; } catch {} }

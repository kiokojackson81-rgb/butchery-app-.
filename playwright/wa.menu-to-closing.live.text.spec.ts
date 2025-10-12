import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || '';
const TEST_WA_E164 = process.env.TEST_WA_E164 || '';
const TEST_CODE_ATT = process.env.TEST_CODE_ATTENDANT || '';

function toDigits(p: string): string { return p.replace(/[^0-9]/g, '').replace(/^0+/, ''); }
function wam() { return `wamid.${Date.now()}.${Math.random().toString(36).slice(2,8)}`; }

async function waitFor<T>(fn: () => Promise<T | boolean>, opts: { timeoutMs: number; intervalMs: number }): Promise<boolean> {
  const deadline = Date.now() + Math.max(1_000, opts.timeoutMs);
  try { if (await fn()) return true; } catch {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.max(100, opts.intervalMs)));
    try { if (await fn()) return true; } catch {}
  }
  return false;
}

test.describe('Live: menu -> "1" text to ATT_CLOSING', () => {
  test.skip(!BASE, 'Set BASE_URL');
  test.skip(!TEST_WA_E164, 'Provide TEST_WA_E164');
  test.skip(!TEST_CODE_ATT, 'Provide TEST_CODE_ATTENDANT');

  test('finalize login, send text "1", observe response', async ({ request }) => {
    const phone = TEST_WA_E164;
    const phoneDigits = toDigits(phone);

    // 1) Finalize login via login-link API
    const fin = await request.post(`${BASE}/api/wa/auth/login-link`, { data: { code: TEST_CODE_ATT, wa: phone } });
    expect(fin.ok()).toBeTruthy();
    const fj = await fin.json().catch(() => ({ ok: false }));
    expect(fj.ok).toBeTruthy();

    // 2) Send webhook text '1'
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{
        id: wam(),
        from: phoneDigits,
        type: 'text',
        text: { body: '1' },
      }] } }] }],
    } as const;

    const startedAt = Date.now();
    const hook = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(hook.ok()).toBeTruthy();

    // 3) Poll logs for a recent outbound response
    const found = await waitFor(async () => {
      const resp = await request.get(`${BASE}/api/wa/logs?to=${phoneDigits}&limit=60`);
      if (!resp.ok()) return false;
      const data = await resp.json().catch(() => ({} as any));
      const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
      const cutoff = startedAt - 3 * 60_000;
      for (const r of rows) {
        const ts = r?.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (ts < cutoff) continue;
        const outbound = r?.direction === 'out';
        const ok = String(r?.status || '').toUpperCase().includes('SENT');
        if (!outbound || !ok) continue;
        // Accept either interactive menu or a guiding text
        const t = String(r?.type || '');
        if (t === 'AI_DISPATCH_INTERACTIVE' || t === 'AI_DISPATCH_TEXT') return true;
      }
      return false;
    }, { timeoutMs: 60_000, intervalMs: 2_000 });

    expect(found).toBeTruthy();
  });
});

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || '';
const ALLOW_REAL = process.env.ALLOW_REAL_WA === 'true';
const TEST_WA_E164 = process.env.TEST_WA_E164 || '';
const TEST_CODE_ATT = process.env.TEST_CODE_ATTENDANT || '';
const IS_DRY = process.env.WA_DRY_RUN === 'true';

// Real WhatsApp send smoke. Triggers a real outbound WA message to TEST_WA_E164 by invoking the login-link API.
// Safety gates:
// - Requires ALLOW_REAL_WA=true
// - Requires TEST_WA_E164 in E.164 format (e.g., +2547XXXXXXX)
// - Requires TEST_CODE_ATTENDANT to be a valid, active production code
// - Skips if WA_DRY_RUN=true (since that defeats the purpose)

test.describe('Login WA real (API)', () => {
  test.skip(!ALLOW_REAL, 'Set ALLOW_REAL_WA=true to enable real WA send');
  test.skip(!TEST_WA_E164, 'Provide TEST_WA_E164 in E.164 format (e.g., +2547XXXXXXX)');
  test.skip(!TEST_CODE_ATT, 'Provide TEST_CODE_ATTENDANT with a valid production code');
  test.skip(IS_DRY, 'Skip when WA_DRY_RUN is true — requires real send');

  test('sends a real WA message and it appears in logs', async ({ request }) => {
    const toDigits = TEST_WA_E164.replace(/[^0-9]/g, '').replace(/^0+/, '');

    // 1) Call login-link API directly to trigger finalize + welcome/menu send
    const resp = await request.post(`${BASE}/api/wa/auth/login-link`, {
      data: { code: TEST_CODE_ATT, wa: TEST_WA_E164 },
    });
    expect(resp.ok()).toBeTruthy();
    const j = await resp.json().catch(() => ({ ok: false } as any));
    expect(j.ok).toBeTruthy();

    // 2) Poll WA logs until we see an outbound SENT to the target that isn't dry-run
    const startedAt = Date.now();
    const found = await waitFor(async () => {
      const r = await request.get(`${BASE}/api/wa/logs?to=${toDigits}&limit=40`);
      if (!r.ok()) return false;
      const data = await r.json().catch(() => ({} as any));
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const cutoff = startedAt - 2 * 60_000; // within last 2 minutes
      for (const row of rows) {
        const created = row?.createdAt ? new Date(row.createdAt).getTime() : 0;
        const notDry = !(row?.payload?.response?.dryRun === true);
        const okStatus = String(row?.status || '').toUpperCase().includes('SENT');
        const outbound = row?.direction === 'out';
        if (outbound && okStatus && notDry && created >= cutoff) return true;
      }
      return false;
    }, { timeoutMs: 60_000, intervalMs: 2_000 });

    expect(found).toBeTruthy();
  });
});

async function waitFor<T>(fn: () => Promise<T | boolean>, opts: { timeoutMs: number; intervalMs: number }): Promise<boolean> {
  const deadline = Date.now() + Math.max(1_000, opts.timeoutMs);
  try { if (await fn()) return true; } catch {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.max(100, opts.intervalMs)));
    try { if (await fn()) return true; } catch {}
  }
  return false;
}

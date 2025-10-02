import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || '';
const ALLOW_REAL = process.env.ALLOW_REAL_WA === 'true';
const TEST_WA_E164 = process.env.TEST_WA_E164 || '';
const IS_DRY = process.env.WA_DRY_RUN === 'true';

// Real WhatsApp login smoke. Sends an actual WA message to TEST_WA_E164.
// Safety gates:
// - Requires ALLOW_REAL_WA=true
// - Requires TEST_WA_E164 to be set to a valid E.164 (e.g., +2547XXXXXXX)
// - Skips if WA_DRY_RUN=true (since that defeats the purpose)

test.describe('Login WA real', () => {
  test.skip(!ALLOW_REAL, 'Set ALLOW_REAL_WA=true to enable real WA send');
  test.skip(!TEST_WA_E164, 'Provide TEST_WA_E164 in E.164 format (e.g., +2547XXXXXXX)');
  test.skip(IS_DRY, 'Skip when WA_DRY_RUN is true — requires real send');

  test('sends a real WA message and it appears in logs', async ({ page }) => {
    const toDigits = TEST_WA_E164.replace(/[^0-9]/g, '').replace(/^0+/, '');

    // 1) Trigger the login start flow which will DM success/failure
    await page.goto(`/login?wa=${encodeURIComponent(TEST_WA_E164)}`);
    await page.fill('#code-input', 'BR1234'); // any code; server DMs success or fail
    await page.getByRole('button', { name: /submit code/i }).click();

    // 2) Poll WA logs until we see an outbound message to TEST_WA_E164 that isn't dry-run
    const startedAt = Date.now();

    const found = await waitFor(async () => {
      const resp = await page.request.get(`/api/wa/logs?to=${toDigits}&limit=30`);
      if (!resp.ok()) return false;
      const data = await resp.json().catch(() => ({} as any));
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      // Look for a recent, outbound, SENT log where payload.response.dryRun !== true
      const cutoff = startedAt - 2 * 60_000; // within last 2 minutes
      for (const r of rows) {
        const created = r?.createdAt ? new Date(r.createdAt).getTime() : 0;
        const notDry = !(r?.payload?.response?.dryRun === true);
        const okStatus = String(r?.status || '').toUpperCase().includes('SENT');
        const outbound = r?.direction === 'out';
        if (outbound && okStatus && notDry && created >= cutoff) {
          return true;
        }
      }
      return false;
    }, { timeoutMs: 45_000, intervalMs: 2_000 });

    expect(found).toBeTruthy();
  });
});

async function waitFor<T>(fn: () => Promise<T | boolean>, opts: { timeoutMs: number; intervalMs: number }): Promise<boolean> {
  const deadline = Date.now() + Math.max(1_000, opts.timeoutMs);
  // First immediate try
  try { if (await fn()) return true; } catch {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.max(100, opts.intervalMs)));
    try { if (await fn()) return true; } catch {}
  }
  return false;
}

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const RUN = process.env.PW_RECON_UI_ALIGNMENT === 'true';

// Always register tests so Playwright discovers the file. Skip at runtime when the env flag is not set.
test.skip(!RUN, 'PW_RECON_UI_ALIGNMENT is not true');

test.describe('Recon UI alignment — Supervisor vs Admin', () => {
  test('server totals match Supervisor and Admin tiles for a given outlet/date', async ({ page, request }) => {
    test.setTimeout(120_000);
    const date = new Date().toISOString().slice(0,10);

    // pick an outlet from admin list
    const rOut = await request.get(`${BASE}/api/admin/list/outlets`, { timeout: 30000 });
    const jOut = await rOut.json();
    const outlet = Array.isArray(jOut?.rows) && jOut.rows.length ? jOut.rows[0].name : (process.env.TEST_OUTLET || 'Main');

    // fetch server recon totals
    const qs = new URLSearchParams({ date, outlet }).toString();
    const rRecon = await request.get(`${BASE}/api/admin/recon/day?${qs}`, { timeout: 30000 });
    const jRecon = await rRecon.json();
    expect(jRecon?.ok).toBeTruthy();
    const totals = jRecon.totals || {};

    // Supervisor page tiles
    await page.goto(`${BASE}/supervisor`);
    await page.getByRole('button', { name: /Deposits Monitor/i }).click();
    // ensure outlet selected
    const outletSelect = page.locator('select').nth(1);
    await outletSelect.selectOption(outlet).catch(()=>{});
    await page.waitForTimeout(1000);

    // read Supervisor expected tile
    const supExpected = await page.getByText(/Expected \(server\)/i).locator('..').locator('div').nth(1).innerText().catch(()=>null);
    const supExpectedNum = Number((supExpected||'').replace(/[^0-9.\-]/g,'')) || 0;

    // Admin page tiles
    await page.goto(`${BASE}/admin`);
    // ensure outlet selection exists
    const admQ = new URLSearchParams({ date, outlet });
    await page.goto(`${BASE}/admin?${admQ.toString()}`);
    await page.waitForTimeout(1000);
    const admExpected = await page.getByText(/Expected \(server\)/i).locator('..').locator('div').nth(1).innerText().catch(()=>null);
    const admExpectedNum = Number((admExpected||'').replace(/[^0-9.\-]/g,'')) || 0;

    // server -> number
    const serverExpectedNum = Number(totals?.expectedSales || 0);

    // Assert equality within 1 Ksh tolerance
    const tol = 1;
    expect(Math.abs(serverExpectedNum - supExpectedNum)).toBeLessThanOrEqual(tol);
    expect(Math.abs(serverExpectedNum - admExpectedNum)).toBeLessThanOrEqual(tol);
  });
});

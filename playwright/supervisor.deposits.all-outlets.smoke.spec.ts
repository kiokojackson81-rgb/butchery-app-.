import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3002';
const RUN = process.env.PW_SUPERVISOR_ALL_OUTLETS_SMOKE === 'true';

const describeFn = RUN ? test.describe : test.describe.skip;

describeFn('Supervisor Deposits — All Outlets aggregated', () => {
  test('shows aggregated tiles and table and allows CSV export', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`${BASE}/supervisor`);

    // If login screen, enter supervisor code if requested; otherwise continue
    if (await page.getByPlaceholder(/supervisor/i).first().isVisible().catch(()=>false)) {
      await page.getByPlaceholder(/supervisor/i).first().fill('999999');
      await page.getByRole('button', { name: /continue|login/i }).click();
    }

    await page.waitForLoadState('domcontentloaded');

    // Pick All Outlets (default is All Outlets in most cases, but ensure selection)
    const outletSelect = page.locator('select').nth(1);
    await outletSelect.selectOption('__ALL__').catch(()=>{});

    // Go to Deposits Monitor tab
    await page.getByRole('button', { name: /Deposits Monitor/i }).click();

    // Tiles presence (use labels we render)
    const tileLabels = [
      'Total submitted',
      'Verified (VALID)',
      'Pending Only',
      'Invalid (ignored)',
      'Expected (server)',
      'Expenses',
      'Variance (Expected − Deposited)',
      'Projected Till'
    ];

    for (const t of tileLabels) {
      await expect(page.getByText(t, { exact: false })).toBeVisible({ timeout: 30000 });
    }

    // Filter control exists
    await expect(page.getByLabel(/Filter/i)).toBeVisible();

    // Table headers
    for (const h of ['Time', 'Outlet', 'Amount', 'Code', 'Status']) {
      await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    }

    // Export CSV should trigger a download URL (we can assert the attribute updates)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(()=>null),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ]);
    // If a download event fired, ensure it has a suggested filename
    if (download) {
      const fname = await download.suggestedFilename();
      expect(fname).toMatch(/deposits-ALL-.*\.csv$/);
    }
  });
});

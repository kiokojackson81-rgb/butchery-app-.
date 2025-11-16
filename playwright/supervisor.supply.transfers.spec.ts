// playwright/supervisor.supply.transfers.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('supply tab shows transfers table heading', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  await page.getByRole('tab', { name: /supply view/i }).click();
  await expect(page.getByText(/Transfers —/)).toBeVisible();
});

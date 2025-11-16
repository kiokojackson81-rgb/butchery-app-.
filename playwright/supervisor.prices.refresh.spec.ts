// playwright/supervisor.prices.refresh.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('prices tab loads table', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  await page.getByRole('tab', { name: /prices/i }).click();
  await expect(page.getByText(/Outlet Prices/i)).toBeVisible();
  // At least one table header
  await expect(page.getByRole('columnheader', { name: /Product/i })).toBeVisible();
});

// playwright/supervisor.commissions.nav.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('commissions tab period navigation controls', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  await page.getByRole('tab', { name: /commissions/i }).click();
  await expect(page.getByRole('heading', { name: /Commissions/i })).toBeVisible();
  // Range select present
  await expect(page.getByRole('combobox').first()).toBeVisible();
  // Export button present
  await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
});

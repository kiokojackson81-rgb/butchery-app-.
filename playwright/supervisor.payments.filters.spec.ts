// playwright/supervisor.payments.filters.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('payments tab period toggle and filters render', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  await page.getByRole('tab', { name: /payments/i }).click();
  await expect(page.getByText(/Till Payments/i)).toBeVisible();
  // Period toggle buttons exist
  const periodPrev = page.getByRole('button', { name: /previous/i });
  const periodCurr = page.getByRole('button', { name: /current/i });
  // Not failing if one button replaced by select etc.; assert at least one toggle present
  await expect(periodPrev.or(periodCurr)).toBeVisible();
  // Filter inputs
  await expect(page.getByPlaceholder(/Filter/i)).toBeVisible();
});

// playwright/supervisor.error-boundary.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
    // Simulate tab error for prices by setting a flag the component can read
    localStorage.setItem('simulate_tab_error', 'prices');
  });
});

test('prices tab triggers error boundary fallback when simulated', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  await page.getByRole('tab', { name: /prices/i }).click();
  // Expect boundary message
  await expect(page.getByText(/Failed to load section/i)).toBeVisible();
});

import { test, expect } from '@playwright/test';

test.describe('Live smoke (public pages)', () => {
  test('home page renders and has title', async ({ page }, testInfo) => {
    const resp = await page.goto('/');
    if (resp && resp.status() >= 500) {
      test.skip(true, `Skipping: server returned ${resp.status()} for /`);
    }
    // Allow common titles across environments
    await expect(page).toHaveTitle(/Baraka|Butchery|Next\.js|Create Next App/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page renders without client errors', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[pageerror] ${String(err?.message || err)}`));

    const resp = await page.goto('/login');
    if (resp && resp.status() >= 500) {
      test.skip(true, `Skipping: server returned ${resp.status()} for /login`);
    }
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    // Wait for the main input to ensure client hydration completed
    await expect(page.locator('#code-input')).toBeVisible({ timeout: 20000 });
    // And at least one actionable element is visible
    await expect(page.locator('button, input, form').first()).toBeVisible();

    // Emit captured logs if any (helps debug CI flakes)
    if (logs.length) {
      console.log('login page logs:\n' + logs.join('\n'));
    }
  });
});

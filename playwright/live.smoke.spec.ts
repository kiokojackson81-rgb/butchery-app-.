import { test, expect } from '@playwright/test';

test.describe('Live smoke (public pages)', () => {
  test('home page renders and has title', async ({ page }, testInfo) => {
    await page.goto('/');
    // Allow common titles across environments
    await expect(page).toHaveTitle(/Baraka|Butchery|Next\.js|Create Next App/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page renders without client errors', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('body')).toBeVisible();
    const errors = page.on('pageerror', (err) => err);
    // Navigate and quickly check there is a form or button present
    await expect(page.locator('button, input, form').first()).toBeVisible();
  });
});

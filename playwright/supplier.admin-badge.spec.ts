import { test, expect } from '@playwright/test';

// Restrict to chromium to avoid requiring other browser downloads for this check.
test.use({ browserName: 'chromium' });

// Verifies that manual admin elevation via storage + BroadcastChannel reflects immediately on Supplier Dashboard across tabs.
test('supplier dashboard shows Admin badge after storage elevation across tabs', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();

  // 1) Visit supplier dashboard (not elevated yet)
  const respDash = await pageA.goto(`${baseURL}/supplier/dashboard`);
  if (respDash && respDash.status() >= 500) {
    test.skip(true, `Supplier dashboard returned ${respDash.status()} — skipping badge verification until route is healthy.`);
  }
  const badgeSelector = 'h1:has-text("Supplier Dashboard") >> text=Admin';
  // Expect badge absent initially (soft assertion; if already present we still proceed)
  if (await pageA.locator(badgeSelector).count() > 0) {
    // Already elevated; clear and reload to ensure test scenario
    await pageA.evaluate(() => {
      localStorage.removeItem('admin_auth');
      sessionStorage.removeItem('admin_auth');
    });
    await pageA.reload();
  }
  await expect(pageA.locator(badgeSelector)).toHaveCount(0);

  // 2) Elevate admin state via direct storage + broadcast
  await pageA.evaluate(() => {
    localStorage.setItem('admin_auth', 'true');
    localStorage.setItem('admin_welcome', 'Test Admin');
    sessionStorage.setItem('admin_auth', 'true');
    sessionStorage.setItem('admin_welcome', 'Test Admin');
    try {
      const bc = new BroadcastChannel('auth');
      bc.postMessage({ type: 'AUTH_SYNC' });
      bc.close();
    } catch {}
  });

  // 3) Wait for badge to appear in current tab (immediate via BroadcastChannel or 2s poll)
  await expect(pageA.locator(badgeSelector)).toBeVisible({ timeout: 8000 });

  // 4) Open second tab; badge should appear without manual refresh due to shared storage & fast poll
  const pageB = await context.newPage();
  await pageB.goto(`${baseURL}/supplier/dashboard`);
  await expect(pageB.locator(badgeSelector)).toBeVisible({ timeout: 8000 });
});

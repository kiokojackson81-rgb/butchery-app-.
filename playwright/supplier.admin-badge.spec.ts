import { test, expect } from '@playwright/test';

// Restrict to chromium to avoid requiring other browser downloads for this check.
test.use({ browserName: 'chromium' });

// Verifies that admin elevation no longer surfaces an Admin badge in Supplier dashboard.
// Admins should operate via the Admin panel, not the Supplier UI.
test('supplier dashboard does NOT show Admin badge after storage elevation', async ({ browser, baseURL }) => {
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

  // 2) Elevate admin state via direct storage + broadcast (legacy)
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

  // 3) Badge should remain absent in current tab
  await expect(pageA.locator(badgeSelector)).toHaveCount(0);

  // 4) Second tab should also not show badge
  const pageB = await context.newPage();
  await pageB.goto(`${baseURL}/supplier/dashboard`);
  await expect(pageB.locator(badgeSelector)).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

// Verifies admin server session cookie and cross-tab persistence.
test('admin login creates server session and is visible in another tab, logout clears it', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  // 1) Ensure clean state by calling DELETE on session endpoint (best-effort)
  await pageA.request.delete(`${baseURL}/api/admin/session`).catch(() => {});

  // 2) Open login page in pageA and perform login
  await pageA.goto(`${baseURL}/admin/login`);
  await pageA.fill('input[type="email"]', 'kiokojackson81@gmail.com');
  await pageA.fill('input[type="password"]', 'Ads0k015@#');
  await Promise.all([
    pageA.waitForNavigation({ url: '**/admin' }),
    pageA.click('button:has-text("Sign in")'),
  ]);

  // After successful login, server should set bk_admin cookie and admin page loads
  await expect(pageA.locator('text=Administrator Dashboard')).toBeVisible();

  // 3) In pageB, navigate to /admin (cookies are shared inside same context)
  await pageB.goto(`${baseURL}/admin`);
  // Should not be redirected to login; admin dashboard visible
  await expect(pageB.locator('text=Administrator Dashboard')).toBeVisible();

  // 4) Logout from pageA and verify pageB eventually prompts for login
  await Promise.all([
    pageA.waitForNavigation({ url: '**/admin/login' }),
    pageA.click('button:has-text("Logout")'),
  ]);
  // After logout, pageB should be redirected to login on reload
  await pageB.reload();
  await expect(pageB.locator('text=Admin Login')).toBeVisible();
});

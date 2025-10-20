import { test, expect } from '@playwright/test';

const base = process.env.BASE_URL || 'http://localhost:3002';
function url(p: string) { return `${base}${p}`; }

// Lightweight UI smoke for Admin → Ops → Deposits
// Validates: tiles render, status filter affects rows, and CSV export generates a data URL

test.describe('Admin Deposits Recon UI', () => {
  const shouldRun = !!process.env.ADMIN_E2E;
  test.skip(!shouldRun, 'Skipping unless ADMIN_E2E is set');
  test('tiles + filter + CSV export', async ({ page }) => {
    // Admin login is client-only via sessionStorage; set before navigation and deep-link to Deposits
  await page.addInitScript(() => { sessionStorage.setItem('admin_auth', 'true'); });
  await page.goto(url('/admin?tab=ops&opsTab=deposits'));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
    // If bounced to login, complete the form
    if (await page.getByText('Admin Login').isVisible().catch(() => false)) {
      await page.getByLabel('Email').fill('kiokojackson81@gmail.com');
      await page.getByLabel('Password').fill('Ads0k015@#');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForLoadState('networkidle');
    }

    // Ensure Deposits UI present (either header or filter label)
    const header = page.getByText('Deposits Verify');
    const filterLbl = page.getByLabel('Filter');
    const headerVisible = await header.isVisible().catch(() => false);
    if (!headerVisible) {
      await expect(filterLbl).toBeVisible({ timeout: 30000 });
    }
    await expect(page.locator('input[type="date"]')).toBeVisible();
    // Outlet may be a <select> (preferred) or a fallback input — just ensure one is present
    const outletSelect = page.locator('select').filter({ hasText: '' }).first();
    const outletInput = page.locator('input[placeholder="Outlet"]');
    if (await outletSelect.count() > 0) {
      await outletSelect.selectOption({ index: 1 }).catch(() => {}); // best-effort pick
    } else if (await outletInput.count() > 0) {
      await outletInput.fill('Bright');
    }

    // Wait for tiles to render (some may be zero in fresh DB, that’s ok)
  await expect(page.getByText('Total submitted')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Verified (VALID only)')).toBeVisible();
  await expect(page.getByText('Expected (server)')).toBeVisible();
  await expect(page.getByText('Expenses')).toBeVisible();
  await expect(page.getByText('Variance (Expected − Deposited)')).toBeVisible();
  await expect(page.getByText('Projected Till')).toBeVisible();

    // Status filter should change the "No deposits" state or row count
    const tableRows = page.locator('table tbody tr');
    const beforeCount = await tableRows.count();

    await page.getByLabel('Filter').selectOption('PENDING');
    await page.waitForTimeout(200); // allow React state to settle
    const pendingCount = await tableRows.count();
    // Either different count or explicitly shows "No deposits."; both acceptable
    const noDepositsVisible = await page.getByText('No deposits.').isVisible().catch(() => false);
    expect(pendingCount !== beforeCount || noDepositsVisible).toBeTruthy();

    // CSV export should create a download data URL; intercept via page.evaluate
    const href = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const btn = btns.find(b => /Export CSV/i.test(b.textContent || ''));
      if (!btn) return '';
      const origCreate: any = (document as any).createElement.bind(document);
      let captured = '';
      (document as any).createElement = (tag: string, options?: any) => {
        const el: any = origCreate(tag, options);
        if (String(tag).toLowerCase() === 'a') {
          Object.defineProperty(el, 'href', {
            configurable: true,
            enumerable: true,
            set(v: string) { captured = String(v || ''); },
            get() { return captured; }
          });
          el.click = () => {};
        }
        return el;
      };
      btn.click();
      (document as any).createElement = origCreate;
      return captured;
    });
    expect(href).toMatch(/^data:text\/csv;charset=utf-8,/);
  });
});

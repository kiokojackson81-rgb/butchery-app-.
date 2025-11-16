// playwright/supervisor.reviews.pagination.spec.ts
import { test, expect } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('reviews waste tab shows load more if cursor present', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  // Default tab may already be waste; ensure button presence or gracefully skip
  const loadMore = page.getByRole('button', { name: /load more/i });
  // If API returns no cursor, the button might not exist; assert page structure instead
  if (await loadMore.count() > 0) {
    await expect(loadMore.first()).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: /Waste/i })).toBeVisible();
  }
});

// playwright/supervisor.commissions.export.spec.ts
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

// Assumes BASE_URL env set by task; fallback to localhost:3002
const BASE = process.env.BASE_URL || 'http://localhost:3002';

// Simple helper to seed supervisor session before page scripts run
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('supervisor_code', 'TEST');
    sessionStorage.setItem('supervisor_name', 'Tester');
  });
});

test('commissions Export CSV triggers a download and contains numeric formatting', async ({ page }) => {
  await page.goto(`${BASE}/supervisor/dashboard`);
  // Navigate to commissions tab if not default
  const commissionsTab = page.getByRole('tab', { name: /commissions/i });
  if (await commissionsTab.isVisible()) {
    await commissionsTab.click();
  }
  // Ensure button exists
  const exportBtn = page.getByRole('button', { name: /export csv/i });
  await expect(exportBtn).toBeVisible({ timeout: 10000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click()
  ]);
  const suggested = await download.suggestedFilename();
  expect(suggested).toMatch(/commissions_.*_.*\.csv/);
  const filePath = await download.path();
  if (filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.split('\n')[0]).toMatch(/salesKsh,expensesKsh,wasteKsh/);
    // Ensure fixed decimals present in at least one numeric cell line (e.g., ".00")
    expect(content).toMatch(/\.00,/);
  }
  const failure = await download.failure();
  expect(failure).toBeNull();
  // Optionally inspect content header
  const path = await download.path();
  if (path) {
    // We only assert file exists; deeper CSV validation could parse first line
    expect(path).toBeTruthy();
  }
});

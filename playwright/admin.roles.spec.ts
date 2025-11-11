import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3002";

// Minimal smoke to ensure changing one person's role doesn't affect others

test.describe("Admin → People & Codes: role changes are per-row", () => {
  test("changing one role does not update other rows", async ({ page }) => {
    test.skip(!/(localhost|127\.0\.0\.1)/i.test(BASE), "Runs only locally against dev server");
    // Set client-only admin session flag before navigation
    await page.addInitScript(() => {
      try { sessionStorage.setItem('admin_auth', 'true'); } catch {}
    });

  await page.goto(`${BASE}/admin`);

  // Ensure we have a couple of rows to work with
  const addBtn = page.getByRole('button', { name: '+ Add code' }).first();
  await addBtn.waitFor({ state: 'visible' });
  await addBtn.click();
  await addBtn.click();

  // Wait for role selects to appear in the table
  const selects = page.locator('select[data-testid^="role-select-"]');
  await expect(selects.first()).toBeVisible();
  await expect(selects.nth(1)).toBeVisible();

    const roleSel0 = selects.nth(0);
    const roleSel1 = selects.nth(1);

    const role0Before = await roleSel0.inputValue();
    const role1Before = await roleSel1.inputValue();

    // Change only the first row's role to a different value
    const newRole = role0Before === 'assistant' ? 'supervisor' : 'assistant';
    await roleSel0.selectOption(newRole);

    // Assert first row changed
    await expect(roleSel0).toHaveValue(newRole);

    // Assert second row unchanged
    await expect(roleSel1).toHaveValue(role1Before);
  });
});

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || '';
const DRY = process.env.WA_DRY_RUN === 'true';

// This spec validates the streamlined WhatsApp login flow without sending a real message.
// Preconditions:
// - Run the app locally in dry-run mode so no WA calls are sent:
//   WA_DRY_RUN=true CHATRACE_ENABLED=false npm run dev
// - Execute tests with BASE_URL=http://localhost:3000

test.describe('Login WA dry-run', () => {
  test.skip(!/localhost:3000/.test(BASE), 'Runs only against local dev');

  test('opens WA chat after code submit and shows status', async ({ page, browserName }) => {
      if (browserName === 'webkit') {
        test.skip(true, 'WebKit navigation to wa.me can be flaky in headless environments');
      }
    // Stub the backend call to ensure deterministic UI behavior across browsers
    await page.route('**/api/wa/auth/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'sent', nonce: 'dryrun' }),
      });
    });
    // No-op: we allow navigation to wa.me if it occurs and accept that as success criterion.

    const wa = '+254700000001'; // test phone in E.164

  await page.goto(`/login?wa=${encodeURIComponent(wa)}`);

    // Fill any plausible code; server will DM result either way in dry-run
    await page.fill('#code-input', 'BR1234');

    // Submit and rely on UI feedback (more robust across browsers than network hooks)
    await page.getByRole('button', { name: /submit code/i }).click();

    // Wait until either the status message appears OR the page navigates to wa.me
    let satisfied = false;
    try {
      await expect(page.getByText(/check\s*whatsapp/i)).toBeVisible({ timeout: 10_000 });
      satisfied = true;
    } catch {}
    if (!satisfied) {
      await page.waitForURL(/wa\.me\//, { timeout: 15_000 });
      satisfied = true;
    }
    expect(satisfied).toBeTruthy();

    // Verify the page attempted to open a WA chat (if business phone is configured)
    // If we stayed on page, we already saw the helper message. If we navigated, the URL is wa.me.
  });
});

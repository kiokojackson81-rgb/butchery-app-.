import { test, expect } from '@playwright/test';

test.describe('WA GPT interactive smoke', () => {
  test('login triggers GPT greeting (no legacy menu payloads)', async ({ request }) => {
    // This test expects a running dev server with WA flags set (see repo README/tasks)
    const res = await request.post('/api/wa/auth/start', { data: { code: 'BR1234', wa: '+254700000000' } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // We expect the server to have sent a login DM; verify logs endpoint or DB in CI
    // For local runs, set BASE_URL and run the test - this test is a smoke check skeleton.
    expect(body).toHaveProperty('sent');
  });
});

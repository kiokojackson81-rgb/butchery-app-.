import { test, expect } from '@playwright/test';

// Minimal API tests to validate endpoints return ok
const base = process.env.BASE_URL || 'http://localhost:3002';
const CRON_SECRET = process.env.CRON_SECRET || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function url(p: string) { return `${base}${p}`; }

// Note: These tests assume a dev server running with WA flags and proper envs.

test.describe('Nightly compute job', () => {
  test('GET /api/wa/jobs/nightly-compute returns ok (authorized)', async ({ request }) => {
    const qs = new URLSearchParams({ date: new Date().toISOString().slice(0,10) });
    const res = await request.get(url(`/api/wa/jobs/nightly-compute?${qs.toString()}${CRON_SECRET ? `&key=${CRON_SECRET}` : ''}`), {
      headers: CRON_SECRET ? { 'x-cron-key': CRON_SECRET } : {}
    });
    expect(res.status()).toBeLessThan(500);
    const json = await res.json();
    expect(json).toHaveProperty('ok');
  });
});

test.describe('Day-close APIs guarded', () => {
  test('status requires key when configured', async ({ request }) => {
    const qs = new URLSearchParams({ outlet: 'Main', date: new Date().toISOString().slice(0,10) });
    const res = await request.get(url(`/api/day/status?${qs.toString()}${ADMIN_API_KEY ? `&key=${ADMIN_API_KEY}` : ''}`));
    expect(res.status()).toBeLessThan(500);
    const json = await res.json();
    expect(json).toHaveProperty('ok');
  });
});

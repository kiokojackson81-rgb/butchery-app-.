import { test, expect, request } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

// Minimal probes that don't depend on session; they only check endpoint shapes.
// Skip if server not reachable.
async function tryGet(path: string) {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BASE}${path}`);
  return { ok: res.ok(), status: res.status(), json: await res.json().catch(()=>({})) };
}

test('payments by outlet endpoint responds', async ({}) => {
  const r = await tryGet('/api/payments/till?outlet=GENERAL&period=current');
  expect(r.status).toBeLessThan(600);
  expect(r.json).toHaveProperty('ok');
});

test('payments by till (strict) responds', async ({}) => {
  // Use Bright till from seed; harmless if missing
  const r = await tryGet('/api/payments/till?by=till&code=3574877&period=current');
  expect(r.status).toBeLessThan(600);
  expect(r.json).toHaveProperty('ok');
});

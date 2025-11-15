import { test, expect, request } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

// Minimal probes that don't depend on session; they only check endpoint shapes.
// Skip if server not reachable.
// Enhanced harness helper: captures raw response text, content-type and logs diagnostics on failure.
async function tryGet(path: string) {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BASE}${path}`);
  const status = res.status();
  const headers = res.headers();
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const rawText = await res.text();
  let parsed: any = {};
  if (/application\/json/i.test(contentType)) {
    try { parsed = JSON.parse(rawText); } catch { parsed = {}; }
  } else {
    // Attempt JSON parse even if content-type is missing (Next.js sometimes omits)
    try { parsed = JSON.parse(rawText); } catch { parsed = {}; }
  }
  if (!parsed.ok || status >= 500) {
    // Log a concise diagnostic snippet (limit body for readability)
    console.log('[diagnostic] GET', path, 'status', status, 'content-type', contentType);
    console.log('[diagnostic] headers', JSON.stringify(headers));
    console.log('[diagnostic] body first 400 chars:\n' + rawText.slice(0,400));
  }
  return { ok: res.ok(), status, json: parsed, text: rawText, contentType };
}

test('payments by outlet endpoint responds', async ({}) => {
  const r = await tryGet('/api/payments/till?outlet=GENERAL&period=current');
  expect(r.status).toBeLessThan(600);
  // If JSON missing, fail with raw diagnostics.
  expect(r.json).toHaveProperty('ok');
});

test('payments by till (strict) responds', async ({}) => {
  // Use Bright till from seed; harmless if missing
  const r = await tryGet('/api/payments/till?by=till&code=3574877&period=current');
  expect(r.status).toBeLessThan(600);
  expect(r.json).toHaveProperty('ok');
});

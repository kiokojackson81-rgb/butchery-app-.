import { test, expect } from '@playwright/test';

// Skip if DB not configured
test.skip(!process.env.DATABASE_URL, 'DATABASE_URL not set');

function ymd(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0,10);
}
function OUTLET() { return `LK_${Math.random().toString(36).slice(2,7)}`; }

// Verifies per-item locking behavior of /api/supply/opening/item
// Flow:
// 1. Submit item for today -> locked
// 2. Attempt second submit same day -> expect 409 (locked)
// 3. Submit same product for tomorrow -> allowed and locked separately
// 4. Read back rows to confirm quantities

test.describe('Supply per-item locking', () => {
  const outlet = OUTLET();
  const productKey = 'beef';
  const today = ymd();
  const tomorrow = ymd(1);

  test('locks first submission and blocks subsequent same-day edits', async ({ request }) => {
    // First submission
    const first = await request.post('/api/supply/opening/item', { data: { date: today, outlet, itemKey: productKey, qty: 5, buyPrice: 100, unit: 'kg', mode: 'add' } });
    expect(first.ok()).toBeTruthy();
    const firstJson = await first.json();
    expect(firstJson.ok).toBe(true);
    expect(firstJson.row.lockedAt).toBeTruthy();
    expect(firstJson.totalQty).toBe(5);

    // Second attempt same day should be blocked (locked)
    const second = await request.post('/api/supply/opening/item', { data: { date: today, outlet, itemKey: productKey, qty: 3, buyPrice: 100, unit: 'kg', mode: 'add' } });
    expect(second.status()).toBe(409); // locked conflict
    const secondJson = await second.json();
    expect(secondJson.ok).toBe(false);

    // New day: should allow fresh submission (independent lock)
    const next = await request.post('/api/supply/opening/item', { data: { date: tomorrow, outlet, itemKey: productKey, qty: 4, buyPrice: 120, unit: 'kg', mode: 'add' } });
    expect(next.ok()).toBeTruthy();
    const nextJson = await next.json();
    expect(nextJson.ok).toBe(true);
    expect(nextJson.totalQty).toBe(4);
    expect(nextJson.row.lockedAt).toBeTruthy();

    // Read back today rows
    const getToday = await request.get(`/api/supply/opening?date=${today}&outlet=${encodeURIComponent(outlet)}`);
    expect(getToday.ok()).toBeTruthy();
    const todayJson = await getToday.json();
    const todayRow = todayJson.rows.find((r: any) => r.itemKey === productKey);
    expect(Number(todayRow?.qty)).toBe(5);
    expect(Boolean(todayRow?.locked)).toBe(true);

    // Read back tomorrow rows
    const getTomorrow = await request.get(`/api/supply/opening?date=${tomorrow}&outlet=${encodeURIComponent(outlet)}`);
    expect(getTomorrow.ok()).toBeTruthy();
    const tomorrowJson = await getTomorrow.json();
    const tomorrowRow = tomorrowJson.rows.find((r: any) => r.itemKey === productKey);
    expect(Number(tomorrowRow?.qty)).toBe(4);
    expect(Boolean(tomorrowRow?.locked)).toBe(true);
  });
});

import { test, expect } from '@playwright/test';

// Skip if DB not configured
 test.skip(!process.env.DATABASE_URL, 'DATABASE_URL not set');

function ymd(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0,10);
}
function OUTLET() { return `LK_${Math.random().toString(36).slice(2,7)}`; }

// Integration: First-close (midday) rotation should reset today's opening rows from closings
// and clear today's closings, effectively unlocking supplier input for the same calendar day.

test.describe('Midday rotation resets supply and clears closings', () => {
  const outlet = OUTLET();
  const productKey = 'beef';
  const today = ymd();

  test('first close resets opening to closing and clears closings', async ({ request }) => {
    // 1) Seed opening row (locked) for today via supplier opening/item
    const openRes = await request.post('/api/supply/opening/item', { data: { date: today, outlet, itemKey: productKey, qty: 5, buyPrice: 100, unit: 'kg', mode: 'add' } });
    expect(openRes.ok()).toBeTruthy();

    // 2) Record a closing for today (simulate attendant close)
    const closeRes = await request.post('/api/attendant/closing', { data: { outlet, date: today, closingMap: { [productKey]: 3 }, wasteMap: { [productKey]: 0 } } });
    expect(closeRes.ok()).toBeTruthy();

    // 3) Trigger first-close rotation
    const rot = await request.post('/api/period/start', { data: { outlet, openingSnapshot: {}, pricebookSnapshot: {} } });
    expect(rot.ok()).toBeTruthy();
    const rotJ = await rot.json();
    expect(rotJ.ok).toBe(true);
    // first close => nextCount should be 1 (or rotated true w/ phase 'first')
    expect(rotJ.details?.phase === 'first' || rotJ.closeCount === 1).toBeTruthy();

    // 4) Verify: today's opening rows now equal today's closing (3 kg), unlocked
    const getOpen = await request.get(`/api/supply/opening?date=${today}&outlet=${encodeURIComponent(outlet)}`);
    expect(getOpen.ok()).toBeTruthy();
    const openJ = await getOpen.json();
    const row = openJ.rows.find((r: any) => r.itemKey === productKey);
    expect(row).toBeTruthy();
    expect(Number(row.qty)).toBe(3);
    // unlocked after rotation (no lockedAt)
    expect(Boolean(row.locked)).toBe(false);

    // 5) Verify: the closings for today were cleared
    const getClosing = await request.get(`/api/attendant/closing?date=${today}&outlet=${encodeURIComponent(outlet)}`);
    expect(getClosing.ok()).toBeTruthy();
    const closingJ = await getClosing.json();
    expect(Object.keys(closingJ.closingMap || {}).length).toBe(0);
  });
});

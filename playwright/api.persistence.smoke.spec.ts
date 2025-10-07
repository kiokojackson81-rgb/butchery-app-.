import { test, expect, request } from '@playwright/test';

// Skip the entire suite when a real database is not configured
test.skip(!process.env.DATABASE_URL, 'Skipping DB persistence tests: DATABASE_URL not set');

function ymd() { return new Date().toISOString().slice(0,10); }
function OUTLET() { return `VT_${Math.random().toString(36).slice(2,7)}`; }

test.describe('API persistence smoke (DB-first)', () => {
  const date = ymd();
  const outlet = OUTLET();

  test('deposits save/read', async ({ request }) => {
    const body = { outlet, entries: [ { code: 'T1', amount: 123, note: 'pw' }, { code: 'T2', amount: 456 } ] };
    const post = await request.post('/api/deposits', { data: body });
    expect(post.ok()).toBeTruthy();
    const get = await request.get(`/api/deposits?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(get.ok()).toBeTruthy();
    const j = await get.json();
    expect(Array.isArray(j.rows)).toBeTruthy();
    expect(j.rows.length).toBeGreaterThanOrEqual(2);
  });

  test('expenses save/read', async ({ request }) => {
    const body = { outlet, items: [ { name: 'Fuel', amount: 300 }, { name: 'Bags', amount: 200 } ] };
    const post = await request.post('/api/expenses', { data: body });
    expect(post.ok()).toBeTruthy();
    const get = await request.get(`/api/expenses?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(get.ok()).toBeTruthy();
    const j = await get.json();
    expect(Array.isArray(j.rows)).toBeTruthy();
    expect(j.rows.length).toBeGreaterThanOrEqual(2);
  });

  test('closings save/read', async ({ request }) => {
    const body = { outlet, date, closingMap: { beef: 5, goat: 2 }, wasteMap: { beef: 1 } };
    const post = await request.post('/api/attendant/closing', { data: body });
    expect(post.ok()).toBeTruthy();
    const get = await request.get(`/api/attendant/closing?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(get.ok()).toBeTruthy();
    const j = await get.json();
    expect(j.ok).toBe(true);
    expect(j.closingMap?.beef).toBe(5);
    expect(j.wasteMap?.beef).toBe(1);
  });

  test('tillcount save/read', async ({ request }) => {
    const save = await request.post('/api/tillcount', { data: { date, outlet, counted: 987 } });
    expect(save.ok()).toBeTruthy();
    const get = await request.get(`/api/tillcount?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(get.ok()).toBeTruthy();
    const j = await get.json();
    expect(j.ok).toBe(true);
    expect(Number(j.counted)).toBe(987);
  });

  test('supply opening save/read', async ({ request }) => {
    const body = { date, outlet, rows: [ { itemKey: 'beef', qty: 10 }, { itemKey: 'goat', qty: 5 } ] };
    const post = await request.post('/api/supply/opening', { data: body });
    expect(post.ok()).toBeTruthy();
    const get = await request.get(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(get.ok()).toBeTruthy();
    const j = await get.json();
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.rows)).toBeTruthy();
    const beef = j.rows.find((r: any) => r.itemKey === 'beef');
    expect(Number(beef?.qty || 0)).toBeGreaterThanOrEqual(10);
  });

  test('supply transfer adjusts openings', async ({ request }) => {
    const outlet2 = OUTLET();
    // Seed some opening rows for both outlets so transfer math is valid
    await request.post('/api/supply/opening', { data: { date, outlet, rows: [ { itemKey: 'beef', qty: 10 } ] } });
    await request.post('/api/supply/opening', { data: { date, outlet: outlet2, rows: [ { itemKey: 'beef', qty: 1 } ] } });
    const move = await request.post('/api/supply/transfer', { data: { date, fromOutletName: outlet, toOutletName: outlet2, itemKey: 'beef', qty: 3, unit: 'kg' } });
    expect(move.ok()).toBeTruthy();
    const a = await request.get(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outlet)}`);
    const b = await request.get(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outlet2)}`);
    const aj = await a.json();
    const bj = await b.json();
    const aBeef = aj.rows.find((r: any) => r.itemKey === 'beef');
    const bBeef = bj.rows.find((r: any) => r.itemKey === 'beef');
    expect(Number(aBeef?.qty)).toBeGreaterThanOrEqual(7);
    expect(Number(bBeef?.qty)).toBeGreaterThanOrEqual(4);
  });

  test('supervisor reviews queue', async ({ request }) => {
    const make = await request.post('/api/supervisor/reviews', { data: [
      { type: 'expense_adjust', outlet, date, payload: { reason: 'test' } },
      { type: 'stock_check', outlet, date, payload: { note: 'verify' } },
    ]});
    expect(make.ok()).toBeTruthy();
    const list = await request.get(`/api/supervisor/reviews?from=${date}&to=${date}&outlet=${encodeURIComponent(outlet)}`);
    expect(list.ok()).toBeTruthy();
    const lj = await list.json();
    expect(lj.ok).toBe(true);
    expect(Array.isArray(lj.items)).toBeTruthy();
    expect(lj.items.length).toBeGreaterThanOrEqual(2);
  });
});

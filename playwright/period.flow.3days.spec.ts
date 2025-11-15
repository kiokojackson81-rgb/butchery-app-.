import { test, expect } from '@playwright/test';

// Skip when no DB configured
test.skip(!process.env.DATABASE_URL, 'Skipping: DATABASE_URL not set');

function ymd(d: Date = new Date()) { return d.toISOString().slice(0,10); }
function addDays(dateStr: string, n: number) { const dt = new Date(dateStr + 'T00:00:00.000Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0,10); }
function OUTLET() { return `PT_${Math.random().toString(36).slice(2,7)}`; }

test.describe('3-day stock flow: supply → closing/waste → carryover/deposit', () => {
  const outlet = OUTLET();

  test('end-to-end across 3 days', async ({ request }) => {
    const D1 = ymd();
    const D2 = addDays(D1, 1);
    const D3 = addDays(D1, 2);

    // 1) Ensure known pricebook (beef @ 1000)
    {
      const pricebookSnapshot = { beef: { sellPrice: 1000, active: true } } as any;
      const body = { outlet, openingSnapshot: {}, pricebookSnapshot };
      const r = await request.post('/api/period/start', { data: body });
      expect(r.ok()).toBeTruthy();
      // Also upsert via admin pricebook endpoint to guarantee presence regardless of rotation timing
      const r2 = await request.post('/api/admin/save-scope-pricebook', { data: { scope: {}, pricebook: { [outlet]: pricebookSnapshot } } });
      expect(r2.ok()).toBeTruthy();
      // Quick sanity: pricebook for this outlet should exist
      const r3 = await request.get(`/api/pricebook/outlet?outlet=${encodeURIComponent(outlet)}`);
      expect(r3.ok()).toBeTruthy();
      const j3 = await r3.json();
      expect(Array.isArray(j3.products)).toBe(true);
    }

    // ===== Day 1 =====
    // Supply: beef 10
    {
      const body = { date: D1, outlet, rows: [ { itemKey: 'beef', qty: 10 } ] };
      const r = await request.post('/api/supply/opening', { data: body });
      expect(r.ok()).toBeTruthy();
    }
    // Expenses (today): 200; Deposits (today): 1000
    {
      const r1 = await request.post('/api/expenses', { data: { outlet, items: [ { name: 'Fuel', amount: 200 } ] } });
      expect(r1.ok()).toBeTruthy();
      const r2 = await request.post('/api/deposits', { data: { outlet, entries: [ { code: 'D1A', amount: 1000 } ] } });
      expect(r2.ok()).toBeTruthy();
    }
    // Closing for D1: closing=6, waste=1 → sold = 10-6-1 = 3 → revenue = 3000
    {
      const body = { outlet, date: D1, closingMap: { beef: 6 }, wasteMap: { beef: 1 } };
      const r = await request.post('/api/attendant/closing', { data: body });
      expect(r.ok()).toBeTruthy();
    }
    // Header(D1): weightSales=3000, expenses=200, amountToDeposit= (3000-200) - 1000 = 1800, carryoverPrev≈0
    let amtToDepositD1 = 0;
    {
      const r = await request.get(`/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${D1}&period=current`);
      expect(r.ok()).toBeTruthy();
      const j = await r.json();
      expect(j.ok).toBe(true);
      expect(Math.round(j.totals.weightSales)).toBe(3000);
      expect(Math.round(j.totals.expenses)).toBe(200);
      const expectedD1 = 3000 - 200 - 1000; // = 1800
      amtToDepositD1 = 3000 - 200 - 1000; // same
      expect(Math.round(j.totals.amountToDeposit)).toBe(expectedD1);
      expect(Math.round(j.totals.carryoverPrev || 0)).toBe(0);
    }

    // ===== Day 2 =====
    // Supply: beef 5
    {
      const body = { date: D2, outlet, rows: [ { itemKey: 'beef', qty: 5 } ] };
      const r = await request.post('/api/supply/opening', { data: body });
      expect(r.ok()).toBeTruthy();
    }
    // Closing for D2: closing=4, waste=0 → sold = 1 → revenue = 1000; expenses/deposits (for D2) remain 0
    {
      const body = { outlet, date: D2, closingMap: { beef: 4 }, wasteMap: { beef: 0 } };
      const r = await request.post('/api/attendant/closing', { data: body });
      expect(r.ok()).toBeTruthy();
    }
    // Header(D2): carryoverPrev should equal D1 outstanding (= 1800). amountToDeposit = carryoverPrev + (1000 - 0) = 2800
    {
      const r = await request.get(`/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${D2}&period=current`);
      expect(r.ok()).toBeTruthy();
      const j = await r.json();
      expect(j.ok).toBe(true);
      expect(Math.round(j.totals.carryoverPrev)).toBe(Math.round(amtToDepositD1));
      expect(Math.round(j.totals.weightSales)).toBe(1000);
      expect(Math.round(j.totals.expenses)).toBe(0);
      expect(Math.round(j.totals.amountToDeposit)).toBe(Math.round(amtToDepositD1 + (1000 - 0))); // 1800 + 1000 = 2800
    }

    // ===== Day 3 =====
    // No supply/closing — just verify carryover from Day 2 (which had revenue 1000, zero expenses/deposits)
    {
      const r = await request.get(`/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${D3}&period=current`);
      expect(r.ok()).toBeTruthy();
      const j = await r.json();
      expect(j.ok).toBe(true);
      // carryoverPrev(D3) = outstanding of D2 = 1000 - 0 - 0 = 1000
      expect(Math.round(j.totals.carryoverPrev)).toBe(1000);
    }
  });
});

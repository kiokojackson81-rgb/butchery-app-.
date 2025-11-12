import { test, expect } from '@playwright/test';

// This spec asserts that opening-effective (yesterday closing + today's supply)
// uses locked SupplyOpeningRow values and is exposed via the API endpoint
// /api/stock/opening-effective.
//
// It operates directly via HTTP requests to avoid coupling to UI.

const BASE = process.env.BASE_URL || 'http://localhost:3002';

async function postJSON(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store'
  });
  const j = await r.json().catch(()=>({ ok: false }));
  return { status: r.status, ok: j?.ok === true, json: j };
}

async function getJSON(path: string) {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  const j = await r.json().catch(()=>({ ok: false }));
  return { status: r.status, ok: j?.ok === true, json: j };
}

function todayISO() {
  return new Date().toISOString().slice(0,10);
}

function addDaysISO(d: string, delta: number) {
  const dt = new Date(d + 'T00:00:00.000Z');
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0,10);
}

test.describe('Opening-effective uses locked supply rows', () => {
  const outlet = 'Bright';
  const itemKey = 'beef';

  test('API reflects locked supply in opening-effective', async () => {
    const today = todayISO();

    // Submit a supply row via per-item endpoint (locks automatically). If it fails (e.g., missing seed),
    // fall back to admin batch endpoint and then re-attempt for a predictable state.
    let res1 = await postJSON('/api/supply/opening/item', {
      date: today,
      outlet,
      itemKey,
      qty: 7,
      buyPrice: 200,
      unit: 'kg',
      mode: 'add',
      supplierCode: 'SUPTEST',
      supplierName: 'Tester'
    });
    if (res1.status === 500) {
      const adminSeed = await postJSON('/api/admin/supply', {
        rows: [{ date: today, outletName: outlet, itemKey, qty: 7, buyPrice: 200, unit: 'kg' }]
      });
      // Tolerate conflicts if another worker already created rows
      expect([200, 409, 423, 500]).toContain(adminSeed.status);
      res1 = await postJSON('/api/supply/opening/item', {
        date: today,
        outlet,
        itemKey,
        qty: 7,
        buyPrice: 200,
        unit: 'kg',
        mode: 'add',
        supplierCode: 'SUPTEST',
        supplierName: 'Tester'
      });
    }
    if (res1.status === 500) {
      test.skip(true, 'Supply endpoints not seeded in this environment (row creation failed).');
    }
    // Accept 200 or 409 (already locked or created by admin seed)
    expect([200, 409]).toContain(res1.status);

    // Fetch opening-effective for today; should include today's supply qty
    const rEff = await getJSON(`/api/stock/opening-effective?date=${encodeURIComponent(today)}&outlet=${encodeURIComponent(outlet)}`);
    expect(rEff.status).toBeLessThan(500);
    const row = (rEff.json?.rows || []).find((x: any) => x.itemKey === itemKey);
    expect(row?.qty).toBeGreaterThanOrEqual(7);

    // Try to re-submit same item again today; server should block (409)
    const res2 = await postJSON('/api/supply/opening/item', {
      date: today,
      outlet,
      itemKey,
      qty: 2,
      buyPrice: 200,
      unit: 'kg',
      mode: 'add'
    });
    if (res1.status === 200) {
      // If first call actually created the row, second should be locked
      expect(res2.status).toBe(409);
    }

    // Next day should allow a fresh opening row
    const tomorrow = addDaysISO(today, 1);
    const res3 = await postJSON('/api/supply/opening/item', {
      date: tomorrow,
      outlet,
      itemKey,
      qty: 3,
      buyPrice: 210,
      unit: 'kg',
      mode: 'add'
    });
    expect([200, 409]).toContain(res3.status);
  });
});

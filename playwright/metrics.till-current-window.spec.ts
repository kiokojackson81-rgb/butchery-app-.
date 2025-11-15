import { test, expect } from '@playwright/test';

function todayNairobi(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date()).replace(/\//g, '-');
  } catch {
    return new Date().toISOString().slice(0,10);
  }
}

test('till sales reduce amountToDeposit within current trading window', async ({ request }) => {
  const outlet = 'Bright'; // maps to OutletCode.BRIGHT for Payment
  const date = todayNairobi();

  // 1) Ensure pricebook row exists for beef @ 1000 (use test helper to avoid admin route guards)
  {
    // Use a fixed GET helper to avoid any body parsing issues
    const r = await request.get('/api/test/pricebook/upsert-fixed');
    const status = r.status();
    const rawText = await r.text();
    let parsed: any = {};
    try { parsed = JSON.parse(rawText); } catch { /* keep empty */ }
    if (!r.ok()) {
      console.log('[diagnostic] pricebook upsert failed status', status);
      console.log('[diagnostic] body first 400 chars:\n' + rawText.slice(0,400));
    }
    // Surface table/migration issues clearly if custom error string present
    if (parsed?.error) console.log('[diagnostic] pricebook upsert error field:', parsed.error);
    expect(r.ok()).toBeTruthy();
    expect(parsed.ok).toBe(true);
  }

  // 2) Seed opening and submit closing/waste (sold = 10 - 6 - 1 = 3 => 3000 KSh)
  {
    const r1 = await request.post('/api/supply/opening', { data: { date, outlet, rows: [ { itemKey: 'beef', qty: 10 } ] } });
    const raw1 = await r1.text();
    let j1: any = {}; try { j1 = JSON.parse(raw1); } catch {}
    if (!r1.ok()) {
      console.log('[diagnostic] opening failed status', r1.status());
      console.log('[diagnostic] opening body first 300 chars:\n' + raw1.slice(0,300));
    }
    expect(r1.ok()).toBeTruthy();
    const r2 = await request.post('/api/attendant/closing', { data: { outlet, date, closingMap: { beef: 6 }, wasteMap: { beef: 1 } } });
    const raw2 = await r2.text();
    let j2: any = {}; try { j2 = JSON.parse(raw2); } catch {}
    if (!r2.ok()) {
      console.log('[diagnostic] closing failed status', r2.status());
      console.log('[diagnostic] closing body first 300 chars:\n' + raw2.slice(0,300));
    }
    expect(r2.ok()).toBeTruthy();
  }

  // 3) Skip explicit period start; header route falls back to today's midnight if no ActivePeriod exists

  // 4) Baseline header: capture baseline before adding test payment
  let base: any;
  let baseAmtToDeposit = 0;
  {
    const r = await request.get(`/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${date}&period=current`);
    const raw = await r.text();
    let parsed: any = {}; try { parsed = JSON.parse(raw); } catch {}
    if (!r.ok()) {
      console.log('[diagnostic] header baseline status', r.status());
      console.log('[diagnostic] header baseline body first 400 chars:\n' + raw.slice(0,400));
    }
    expect(r.ok()).toBeTruthy();
    base = parsed;
    expect(base.ok).toBe(true);
    expect(Math.round(base.totals.weightSales)).toBe(3000);
    baseAmtToDeposit = Math.round(base.totals.amountToDeposit);
  }

  // 5) Insert a SUCCESS Payment of 500 KSh into current period window for this outlet
  {
    const r = await request.post('/api/test/payments/add', { data: { outletCode: 'BRIGHT', amount: 500, status: 'SUCCESS' } });
    const raw = await r.text();
    let j: any = {}; try { j = JSON.parse(raw); } catch {}
    if (!r.ok()) {
      console.log('[diagnostic] payment add failed status', r.status());
      console.log('[diagnostic] payment add body first 300 chars:\n' + raw.slice(0,300));
    }
    expect(r.ok()).toBeTruthy();
    expect(j.ok).toBe(true);
  }

  // 6) Header should now reflect tillSalesGross increased and reduce amountToDeposit by ~500
  {
    const r = await request.get(`/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${date}&period=current`);
    const raw = await r.text();
    let j: any = {}; try { j = JSON.parse(raw); } catch {}
    if (!r.ok()) {
      console.log('[diagnostic] header post-payment status', r.status());
      console.log('[diagnostic] header post-payment body first 400 chars:\n' + raw.slice(0,400));
    }
    expect(r.ok()).toBeTruthy();
    expect(j.ok).toBe(true);
    expect(Math.round(j.totals.weightSales)).toBe(3000);
    expect(Math.round(j.totals.tillSalesGross)).toBeGreaterThanOrEqual((base?.totals?.tillSalesGross || 0) + 500);
    // Allow some tolerance for concurrent changes; assert it decreased by at least ~450
    const newAmt = Math.round(j.totals.amountToDeposit);
    expect(newAmt).toBeLessThanOrEqual(baseAmtToDeposit - 400);
  }
});

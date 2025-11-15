// scripts/simulate_flow.js
// Simulate 3-day flow: supplies, closings, deposits, and period rotation
// Run with: node scripts/simulate_flow.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3002';
const outlet = 'Baraka B';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensurePrice(productKey, price) {
  try {
    await prisma.pricebookRow.upsert({
      where: { outletName_productKey: { outletName: outlet, productKey } },
      create: { outletName: outlet, productKey, sellPrice: price, active: true },
      update: { sellPrice: price, active: true },
    });
  } catch (e) { console.error('price upsert err', e); }
}

async function createSupply(date, rows) {
  for (const r of rows) {
    try {
      await prisma.supplyOpeningRow.create({ data: { date, outletName: outlet, itemKey: r.itemKey, qty: r.qty, unit: r.unit || 'kg', buyPrice: r.buyPrice || 0 } });
    } catch (e) { console.error('supply create err', e); }
  }
}

async function createClosing(date, closings) {
  for (const c of closings) {
    try {
      await prisma.attendantClosing.create({ data: { date, outletName: outlet, itemKey: c.itemKey, closingQty: c.closingQty, wasteQty: c.wasteQty } });
    } catch (e) { console.error('closing create err', e); }
  }
}

async function createDeposit(date, amount, status='VALID') {
  try {
    await prisma.attendantDeposit.create({ data: { date, outletName: outlet, code: `SIM${Date.now()}`, note: 'simulate', amount, status } });
  } catch (e) { console.error('deposit create err', e); }
}

async function callPeriodStart(openingSnapshot) {
  try {
    const pricebookSnapshot = {};
    const res = await fetch(`${BASE}/api/period/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outlet, openingSnapshot, pricebookSnapshot }),
    });
    const j = await res.json().catch(()=>null);
    return j;
  } catch (e) { console.error('period start err', e); return null; }
}

async function fetchHeader(date, periodParam) {
  try {
    const url = new URL(`${BASE}/api/metrics/header`);
    url.searchParams.set('outlet', outlet);
    if (date) url.searchParams.set('date', date);
    if (periodParam) url.searchParams.set('period', periodParam);
    const res = await fetch(url.href, { cache: 'no-store' });
    const j = await res.json();
    return j;
  } catch (e) { console.error('fetch header err', e); return null; }
}

async function main() {
  // Dates (3-day window ending today)
  const day3 = new Date();
  const toISO = (d) => d.toISOString().slice(0,10);
  const day2 = new Date(day3); day2.setDate(day3.getDate() - 1);
  const day1 = new Date(day3); day1.setDate(day3.getDate() - 2);
  const d1 = toISO(day1), d2 = toISO(day2), d3 = toISO(day3);
  console.log('Using dates:', d1, d2, d3, 'outlet:', outlet);

  // Test product keys and deterministic prices
  const products = [ { key: 'beef', price: 100 }, { key: 'potatoes', price: 130 } ];

  // Clean up any pre-existing rows for these dates/outlet to avoid conflicts
  console.log('Cleaning existing rows for 3 days (and old pricebook rows for test products)...');
  try {
    await prisma.attendantDeposit.deleteMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    await prisma.attendantClosing.deleteMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    await prisma.supplyOpeningRow.deleteMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    await prisma.attendantExpense.deleteMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    // Remove any saved period snapshot settings that could affect header computations
    const snapKeys = [];
    for (const d of [d1, d2, d3]) {
      snapKeys.push(`snapshot:closing:${d}:${outlet}:1`);
      snapKeys.push(`snapshot:closing:${d}:${outlet}:2`);
    }
    await prisma.setting.deleteMany({ where: { key: { in: snapKeys } } }).catch(()=>{});
    // Remove any pricebook rows for this outlet and our test keys to ensure deterministic prices
    for (const p of products) {
      await prisma.pricebookRow.deleteMany({ where: { outletName: outlet, productKey: p.key } }).catch(()=>{});
    }
  } catch(e){ console.error('cleanup err', e); }

  // Re-create deterministic pricebook rows AFTER cleanup so they remain
  for (const p of products) await ensurePrice(p.key, p.price);

  // Day 1: supplier posts opening, attendant closes, deposit > sales to create EXCESS
  console.log('\nDay1:', d1, 'create supply and closing and large deposit (excess)');
  // Opening: beef 3kg, potatoes 5kg
  await createSupply(d1, [ { itemKey: 'beef', qty: 3, unit: 'kg' }, { itemKey: 'potatoes', qty: 5, unit: 'kg' } ]);
  // Closing: beef closing 2 => sold 1; potatoes closing 0 => sold 5
  await createClosing(d1, [ { itemKey: 'beef', closingQty: 2, wasteQty: 0 }, { itemKey: 'potatoes', closingQty: 0, wasteQty: 0 } ]);
  // deposit more than sales revenue (sales = 1*100 + 5*130 = 750) => deposit 1000 -> surplus 250
  await createDeposit(d1, 1000, 'VALID');

  // Call period/start to snapshot/rotate (first close then second to demonstrate snapshot)
  const openSnap1 = { beef: 3, potatoes: 5 };
  console.log('Calling period/start for Day1...');
  const ps1 = await callPeriodStart(openSnap1);
  console.log('Period start response:', ps1);
  await sleep(500);

  // Day 2: create supply and closing, no deposit
  console.log('\nDay2:', d2, 'supply and closing (no deposit)');
  // Opening: beef 4kg, closing 1 => sold 3
  await createSupply(d2, [ { itemKey: 'beef', qty: 4, unit: 'kg' } ]);
  await createClosing(d2, [ { itemKey: 'beef', closingQty: 1, wasteQty: 0 } ]); // sold 3
  // no deposit
  const openSnap2 = { beef: 4 };
  console.log('Calling period/start for Day2...');
  const ps2 = await callPeriodStart(openSnap2);
  console.log('Period start response:', ps2);
  await sleep(500);

  // Simulate a proper snapshot for the closed period so header will use it as the previously
  // closed trading period when viewing current day. This snapshot should represent the
  // aggregated opening/closing for the closed period (day1+day2) and include the deposit.
  try {
    const snapKey = `snapshot:closing:${d3}:${outlet}:2`;
    const snapVal = {
      date: d3,
      type: 'period_reset_snapshot',
      outlet: outlet,
      // openingSnapshot aggregated across closed period (beef sold total 4, potatoes 5)
      openingSnapshot: { beef: 4, potatoes: 5 },
      closings: [],
      expenses: [],
      deposits: [ { id: `SIM-SNAP-${Date.now()}`, date: d1, outletName: outlet, code: 'SIM', note: 'simulate snap', amount: 1000, status: 'VALID', createdAt: new Date().toISOString() } ],
      closeIndex: 2,
      createdAt: new Date().toISOString(),
    };
    await prisma.setting.deleteMany({ where: { key: snapKey } }).catch(()=>{});
    await prisma.setting.create({ data: { key: snapKey, value: snapVal } }).catch((e)=>{ console.error('snap create err', e); });
    console.log('Inserted simulated snapshot for closed period:', snapKey);
  } catch (e) { console.error('snapshot insert err', e); }

  // Day 3: current day, create supply only (no closings yet)
  console.log('\nDay3:', d3, 'supply only');
  await createSupply(d3, [ { itemKey: 'beef', qty: 2, unit: 'kg' } ]);

  // Compute expected values for verification
  // Day1 sales: beef 1*100 + potatoes 5*130 = 100 + 650 = 750; deposit 1000 -> carryover/excess = 750 - 1000 = -250
  const expectedDay1 = { sales: 750, deposit: 1000, carryover: 750 - 1000 }; // -250
  // Day2 sales: beef sold 3 * 100 = 300; no deposit -> carryover becomes previous + today - deposits = (-250) + 300 - 0 = 50
  const expectedDay2 = { sales: 300, deposit: 0, carryover: expectedDay1.carryover + 300 - 0 }; // 50
  // Day3 (current, no closings yet): openingValue from supply = beef 2*100 = 200
  const expectedDay3 = { openingValue: 2 * 100, carryoverPrev: expectedDay2.carryover };

  console.log('\nExpected Day1:', expectedDay1);
  console.log('Expected Day2:', expectedDay2);
  console.log('Expected Day3 (current):', expectedDay3);

  // Debug: list actual opening rows and pricebook rows that influence header metrics
  try {
    const opensD3 = await prisma.supplyOpeningRow.findMany({ where: { date: d3, outletName: outlet } });
    console.log('\n[snapshot] supplyOpeningRow for Day3:', opensD3.map(r => ({ itemKey: r.itemKey, qty: r.qty })));
  } catch (e) { console.error('debug open rows err', e); }
  try {
    const opensD2 = await prisma.supplyOpeningRow.findMany({ where: { date: d2, outletName: outlet } });
    console.log('\n[snapshot] supplyOpeningRow for Day2:', opensD2.map(r => ({ itemKey: r.itemKey, qty: r.qty })));
  } catch (e) { console.error('debug open rows d2 err', e); }
  try {
    const opensD1 = await prisma.supplyOpeningRow.findMany({ where: { date: d1, outletName: outlet } });
    console.log('\n[snapshot] supplyOpeningRow for Day1:', opensD1.map(r => ({ itemKey: r.itemKey, qty: r.qty })));
  } catch (e) { console.error('debug open rows d1 err', e); }
  try {
    const pbs = await prisma.pricebookRow.findMany({ where: { outletName: outlet } });
    console.log('\n[snapshot] pricebook rows for outlet (count):', pbs.length);
    // print only test keys + a small sample
    console.log('pricebook sample:', pbs.slice(0,20).map(r => ({ key: r.productKey, price: r.sellPrice, active: r.active })));
  } catch (e) { console.error('debug pb err', e); }

  // Debug: any period snapshot settings for current date
  try {
    const snap1 = await prisma.setting.findUnique({ where: { key: `snapshot:closing:${d3}:${outlet}:1` } }).catch(()=>null);
    const snap2 = await prisma.setting.findUnique({ where: { key: `snapshot:closing:${d3}:${outlet}:2` } }).catch(()=>null);
    console.log('\n[snapshot] setting snap1:', snap1 ? { key: snap1.key, value: typeof snap1.value === 'string' ? snap1.value.slice(0,200) : snap1.value } : null);
    console.log('[snapshot] setting snap2:', snap2 ? { key: snap2.key, value: typeof snap2.value === 'string' ? snap2.value.slice(0,200) : snap2.value } : null);
  } catch (e) { console.error('debug snap err', e); }

  // Debug: list closings and deposits for the three days
  try {
    const closings = await prisma.attendantClosing.findMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    console.log('\n[snapshot] attendantClosing for 3 days:', closings.map(c => ({ date: c.date, itemKey: c.itemKey, closingQty: c.closingQty })));
  } catch (e) { console.error('debug closings err', e); }
  try {
    const deps = await prisma.attendantDeposit.findMany({ where: { outletName: outlet, date: { in: [d1,d2,d3] } } });
    console.log('\n[snapshot] attendantDeposit for 3 days:', deps.map(d => ({ date: d.date, amount: d.amount, status: d.status })));
  } catch (e) { console.error('debug deps err', e); }

  // Fetch header totals for current and previous
  console.log('\nFetching header totals (current)');
  const hCurrent = await fetchHeader(null, null); // current
  console.log(JSON.stringify(hCurrent, null, 2));

  console.log('\nFetching header totals (previous calendar day)');
  const hPrev = await fetchHeader(d2, 'previous');
  console.log(JSON.stringify(hPrev, null, 2));

  // Also fetch explicit previous for day1 to see that excess persisted
  console.log('\nFetching header totals (explicit previous for day1)');
  const hPrev1 = await fetchHeader(d1, 'previous');
  console.log(JSON.stringify(hPrev1, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('main err', e); try { await prisma.$disconnect(); } catch {} process.exit(1); });

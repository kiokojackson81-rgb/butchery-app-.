#!/usr/bin/env node
// Trigger supply lock and day-close via HTTP against the dev server (:3002)
// Useful to verify DRY WhatsApp logging without importing server internals.

const outletArg = process.argv[2] || 'MainOutlet';
const base = process.env.BASE_URL || 'http://localhost:3002';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const date = todayISO();
  console.log('Base:', base, 'Outlet:', outletArg, 'Date:', date);

  console.log('\n-- Supply lock notify');
  const supply = await postJson(`${base}/api/supply/lock`, { date, outlet: outletArg, supplierCode: null });
  console.log('status:', supply.status, 'json:', JSON.stringify(supply.json));

  console.log('\n-- Day close notify');
  const closing = await postJson(`${base}/api/attendant/closing`, { outlet: outletArg, date, closingMap: {}, wasteMap: {} });
  console.log('status:', closing.status, 'json:', JSON.stringify(closing.json));

  console.log('\nNow inspect WA logs (admin fallback):');
  console.log('  node scripts/inspect-wa-timeline.mjs +254705663175');
}

main().catch((e) => { console.error(e); process.exit(2); });

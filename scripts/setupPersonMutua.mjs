// Create person Mutua with code MutiaA, map phone, and assign scope.
// Usage: BASE_URL=https://barakafresh.com node scripts/setupPersonMutua.mjs

const BASE_URL = process.env.BASE_URL || 'https://barakafresh.com';

async function post(path, body) {
  const r = await fetch(new URL(path, BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json };
}

async function get(path) {
  const r = await fetch(new URL(path, BASE_URL));
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json };
}

(async () => {
  const code = 'MutiaA';
  const name = 'Mutua';
  const role = 'attendant';
  const outlet = 'Baraka A';
  const phone = '+254705663175';
  const productKeys = ['beef', 'goat'];

  console.log(`[1/6] Reading baseline admin_codes...`);
  const baseline = await get('/api/settings/admin_codes');
  const existing = Array.isArray(baseline.json?.value) ? baseline.json.value : [];
  console.log(' ->', baseline.status, Array.isArray(existing) ? `${existing.length} existing` : baseline.json);

  console.log(`[2/6] Upserting person code ${code} (${role}) (baseline-preserving)...`);
  const up1 = await post('/api/admin/attendants/upsert', {
    people: [...existing, { code, role, name, active: true, outlet }],
  });
  console.log(' ->', up1.status, up1.json);
  if (!up1.ok) process.exitCode = 1;

  console.log(`[3/6] Upserting phone mapping for ${code} -> ${phone}...`);
  const up2 = await post('/api/admin/phone-mapping', {
    code,
    role,
    phoneE164: phone,
    outlet,
  });
  console.log(' ->', up2.status, up2.json);
  if (!up2.ok) process.exitCode = 1;

  console.log(`[4/6] Saving scope for ${code}: ${outlet} / ${productKeys.join(', ')}...`);
  const up3 = await post('/api/admin/scope', {
    [code]: { outlet, productKeys },
  });
  console.log(' ->', up3.status, up3.json);
  if (!up3.ok) process.exitCode = 1;

  console.log('[5/6] Reading admin_codes setting...');
  const s1 = await get('/api/settings/admin_codes');
  console.log(' ->', s1.status, Array.isArray(s1.json?.value) ? s1.json.value.length + ' entries' : s1.json);

  console.log('[6/6] Reading assignments list...');
  const s2 = await get('/api/admin/assignments/list');
  const scope = s2.json?.scope || {};
  const key = code.toUpperCase();
  // Scope map keys are canonical (normalized full); normalize quickly
  const found = Object.keys(scope).find((k) => k.toUpperCase() === key.toUpperCase()) || key;
  console.log(' ->', s2.status, scope[found] || scope[key] || '(not in list)');

  if (!up1.ok || !up2.ok || !up3.ok) {
    console.error('One or more operations failed. See logs above.');
    process.exit(1);
  }
})();

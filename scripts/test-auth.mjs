import fetch from 'node-fetch';

const base = 'http://localhost:3000';
const payloads = [
  { code: ' 00 1a ' },
  { code: '001 A' },
  { code: '001a' },
];

async function call(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  const endpoints = [
    '/api/auth/attendant',
    '/api/auth/supervisor',
    '/api/auth/supplier',
  ];
  for (const p of payloads) {
    console.log(`\nPayload:`, p);
    for (const ep of endpoints) {
      try {
        const out = await call(ep, p);
        console.log(ep, out);
      } catch (e) {
        console.log(ep, 'ERR', e.message);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

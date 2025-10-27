#!/usr/bin/env tsx
/**
 * Register C2B confirmation and validation URLs with Safaricom.
 * Requires: DARAJA_BASE_URL, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_C2B_SHORTCODE, PUBLIC_BASE_URL
 */
import assert from 'assert';

function env(n: string) {
  const v = process.env[n];
  assert(v, `${n} must be set`);
  return v as string;
}

async function getToken(base: string, key: string, secret: string) {
  const cred = Buffer.from(`${key}:${secret}`).toString('base64');
  const url = `${base.replace(/\/$/, '')}/oauth/v1/generate?grant_type=client_credentials`;
  const r = await fetch(url, { headers: { Authorization: `Basic ${cred}` }, cache: 'no-store' });
  if (!r.ok) throw new Error(`token fetch failed ${r.status}`);
  const j = await r.json();
  return j.access_token as string;
}

async function main() {
  const base = process.env.DARAJA_BASE_URL || 'https://api.safaricom.co.ke';
  const key = env('DARAJA_CONSUMER_KEY');
  const secret = env('DARAJA_CONSUMER_SECRET');
  const shortcode = env('DARAJA_C2B_SHORTCODE');
  const pub = env('PUBLIC_BASE_URL');

  const token = await getToken(base, key, secret);

  const body = {
    ShortCode: shortcode,
    ResponseType: 'Completed',
    ConfirmationURL: `${pub.replace(/\/$/, '')}/api/daraja/c2b/confirm`,
    ValidationURL: `${pub.replace(/\/$/, '')}/api/daraja/c2b/validate`,
  };

  const url = `${base.replace(/\/$/, '')}/mpesa/c2b/v2/registerurl`;
  console.log('[daraja:register] POST', url);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await r.text();
  try {
    console.log('[daraja:register] status', r.status, JSON.parse(txt));
  } catch {
    console.log('[daraja:register] status', r.status, txt);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

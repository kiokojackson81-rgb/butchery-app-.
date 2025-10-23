#!/usr/bin/env tsx
/**
 * Perform a test STK push using env credentials. This DOES perform a live API call.
 * Use with caution and only after confirming.
 * Requires: DARAJA_BASE_URL, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_C2B_SHORTCODE, DARAJA_PASSKEY_HO, PUBLIC_BASE_URL
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

export async function makePassword(shortcode: string, passkey: string) {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0,14);
  const raw = `${shortcode}${passkey}${ts}`;
  return { password: Buffer.from(raw).toString('base64'), timestamp: ts };
}

async function main() {
  console.log('WARNING: This will attempt a live STK push. Confirm you want to proceed.');
  // do not auto-run STK push
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}

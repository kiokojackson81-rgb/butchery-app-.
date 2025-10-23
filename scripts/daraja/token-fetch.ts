#!/usr/bin/env tsx
/**
 * Simple token fetcher for Daraja (uses DARAJA_BASE_URL, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET)
 */
import assert from 'assert';

function env(n: string) {
  const v = process.env[n];
  assert(v, `${n} must be set`);
  return v as string;
}

async function main() {
  const base = process.env.DARAJA_BASE_URL || 'https://api.safaricom.co.ke';
  const key = env('DARAJA_CONSUMER_KEY');
  const secret = env('DARAJA_CONSUMER_SECRET');
  const cred = Buffer.from(`${key}:${secret}`).toString('base64');

  const url = `${base.replace(/\/$/, '')}/oauth/v1/generate?grant_type=client_credentials`;
  console.log('[daraja:token] requesting token from', url);
  const res = await fetch(url, { headers: { Authorization: `Basic ${cred}` }, cache: 'no-store' });
  const txt = await res.text();
  if (!res.ok) {
    console.error('[daraja:token] error', res.status, txt);
    process.exitCode = 2;
    return;
  }
  const json = JSON.parse(txt);
  console.log('[daraja:token] success, access_token:', json.access_token);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

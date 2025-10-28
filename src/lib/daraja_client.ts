import { z } from 'zod';
import logger from './logger';

const envSchema = z.object({
  DARAJA_BASE_URL: z.string().url(),
  DARAJA_CONSUMER_KEY: z.string().min(1),
  DARAJA_CONSUMER_SECRET: z.string().min(1),
  DARAJA_PASSKEY_HO: z.string().min(1).optional(),
  DARAJA_LIVE_MODE: z.string().optional(),
  DARAJA_VERIFY_PATH: z.string().optional(),
});

let cachedConfig: null | Record<string, string | undefined> = null;

function ensureConfig() {
  if (cachedConfig) return cachedConfig;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.errors.map((e) => e.path.join('.')).join(', ');
    // eslint-disable-next-line no-console
    console.error('[daraja_client] missing/invalid env:', missing);
    throw new Error('Daraja client misconfigured');
  }
  cachedConfig = parsed.data as Record<string, string | undefined>;
  return cachedConfig;
}

export type DarajaTokenResponse = { access_token: string; expires_in?: number };

async function fetchToken(): Promise<string> {
  const { DARAJA_BASE_URL: BASE, DARAJA_CONSUMER_KEY: KEY, DARAJA_CONSUMER_SECRET: SECRET } = ensureConfig();
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  logger.info({ action: 'token:fetch:request', outletCode: undefined });
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    logger.error({ action: 'token:fetch:error', status: res.status, raw: txt });
    throw new Error(`[daraja_client] token fetch failed: ${res.status}`);
  }
  const data = await res.json() as DarajaTokenResponse;
  logger.info({ action: 'token:fetch:success', expires_in: data.expires_in });
  return data.access_token;
}

export function yyyymmddhhmmss(d = new Date()) {
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

export function makePassword(shortcode: string, passkey?: string, timestamp?: string) {
  const ts = timestamp || yyyymmddhhmmss();
  // allow passkey override; fallback to env if present
  const pk = passkey || (process.env.DARAJA_PASSKEY_HO ?? '') || '';
  const raw = `${shortcode}${pk}${ts}`;
  return { password: Buffer.from(raw).toString('base64'), timestamp: ts };
}

export async function darajaPost<T = any>(path: string, token: string, body: any): Promise<T> {
  const { DARAJA_BASE_URL: BASE } = ensureConfig();
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error({ action: 'darajaPost:error', path, status: res.status, raw: json });
    const err = new Error(`Daraja ${path} failed: ${res.status}`);
    (err as any).payload = json;
    throw err;
  }
  return json as T;
}

export type StkPushResult = { MerchantRequestID?: string; CheckoutRequestID?: string; ResponseCode?: string | number; ResponseDescription?: string };

export async function stkPush(opts: { businessShortCode: string; amount: number; phoneNumber: string; accountReference?: string; transactionDesc?: string; partyB?: string; passkey?: string; transactionType?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline' }) {
  if (opts.amount <= 0) throw new Error('amount must be > 0');
  const token = await fetchToken();
  const { password, timestamp } = makePassword(opts.businessShortCode, opts.passkey);
  const body = {
    BusinessShortCode: opts.businessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: opts.transactionType || 'CustomerPayBillOnline',
    Amount: opts.amount,
    PartyA: opts.phoneNumber,
    PartyB: opts.partyB || opts.businessShortCode,
    PhoneNumber: opts.phoneNumber,
    CallBackURL: process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/mpesa/stk-callback` : undefined,
    AccountReference: opts.accountReference || 'BUTCHERY',
    TransactionDesc: opts.transactionDesc || 'Payment',
  };
  if (!body.CallBackURL) throw new Error('PUBLIC_BASE_URL must be set for callbacks');
  const res = await darajaPost<StkPushResult>('/mpesa/stkpush/v1/processrequest', token, body);
  return { token, res } as const;
}

export const DarajaClient = {
  fetchToken,
  makePassword,
  darajaPost,
  stkPush,
};

// STK Push Query
export type StkQueryResult = { ResponseCode?: string | number; ResponseDescription?: string; ResultCode?: number; ResultDesc?: string; MerchantRequestID?: string; CheckoutRequestID?: string };

export async function stkQuery(opts: { businessShortCode: string; checkoutRequestId: string; passkey?: string }) {
  if (!opts.businessShortCode || !opts.checkoutRequestId) throw new Error('businessShortCode and checkoutRequestId required');
  const token = await fetchToken();
  const { password, timestamp } = makePassword(opts.businessShortCode, opts.passkey);
  const body = {
    BusinessShortCode: opts.businessShortCode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: opts.checkoutRequestId,
  };
  const res = await darajaPost<StkQueryResult>('/mpesa/stkpushquery/v1/query', token, body);
  return { token, res } as const;
}

export const DarajaQuery = {
  stkQuery,
};

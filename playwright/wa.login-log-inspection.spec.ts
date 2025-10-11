import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function digits(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function parseTs(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NaN;
}

function summarizeGreeting(row: any) {
  const createdAt = row?.createdAt || null;
  const status = row?.status || 'UNKNOWN';
  const payload = row?.payload || {};
  const meta = (payload as any)?.meta || {};
  const greeting = meta?.greeting || null;
  const errors: string[] = Array.isArray(greeting?.errors)
    ? greeting.errors.map((e: any) => String(e))
    : [];
  return {
    createdAt,
    status,
    greetingOk: Boolean(greeting?.ok),
    greetingVia: greeting?.via || null,
    fallback: Boolean(greeting?.fallback),
    errors,
  };
}

function summarizeSend(row: any) {
  const createdAt = row?.createdAt || null;
  const status = row?.status || 'UNKNOWN';
  const type = row?.type || 'UNKNOWN';
  const payload = row?.payload || {};
  const meta = payload?.meta || {};
  const response = payload?.response || {};
  return {
    createdAt,
    status,
    type,
    reason: meta?.reason || null,
    sendError: meta?.send_error || null,
    via: payload?.via || null,
    noop: Boolean((response as any)?.noop),
    dryRun: Boolean((response as any)?.dryRun),
    statusCode: payload?.status || null,
  };
}

test.describe('WA login greeting delivery logs', () => {
  const phone = process.env.WA_INSPECT_PHONE || '';
  const limit = Number(process.env.WA_INSPECT_LOG_LIMIT || '40') || 40;

  test.skip(!phone, 'Set WA_INSPECT_PHONE to inspect remote WhatsApp logs.');

  test('reports latest login greeting transport results', async () => {
    const targetDigits = digits(phone);
    expect(targetDigits.length).toBeGreaterThan(5);

    const base = process.env.BASE_URL || 'https://barakafresh.com';
    const url = `${base.replace(/\/$/, '')}/api/wa/logs?to=${targetDigits}&limit=${limit}`;
    const { stdout, stderr } = await execFileAsync('curl', ['-sS', url]);
    if (!stdout?.trim()) {
      console.log('curl stderr:', stderr?.toString?.() || '');
    }
    const data = JSON.parse(stdout || '{}');
    const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];

    const greetingRows = rows.filter((row) => {
      const payload = row?.payload || {};
      const event = payload?.event || payload?.meta?.event || null;
      return event === 'login_welcome_sent' || row?.type === 'login_welcome_sent';
    });

    const sendRows = rows.filter((row) => {
      const type = String(row?.type || '');
      if (!/^AI_DISPATCH_/.test(type)) return false;
      const payload = row?.payload || {};
      const meta = payload?.meta || {};
      const phoneField = String(meta?.phoneE164 || payload?.phone || '');
      return digits(phoneField) === targetDigits;
    });

    console.log(`Fetched ${rows.length} log rows for ${phone}. Latest login_welcome_sent entries:`);
    for (const entry of greetingRows) {
      console.log(JSON.stringify(summarizeGreeting(entry)));
      const ts = parseTs(entry?.createdAt);
      if (!Number.isNaN(ts)) {
        const related = sendRows.filter((row) => {
          const sendTs = parseTs(row?.createdAt);
          if (Number.isNaN(sendTs)) return false;
          return Math.abs(sendTs - ts) <= 60_000; // +/- 60s window
        });
        if (related.length) {
          console.log('  Related send attempts:');
          for (const item of related) {
            console.log(`  ${JSON.stringify(summarizeSend(item))}`);
          }
        }
      }
    }

    expect(greetingRows.length).toBeGreaterThan(0);

    const failures = greetingRows.filter((row) => {
      const meta = (row?.payload || {})?.meta || {};
      const greeting = meta?.greeting;
      if (!greeting) return row?.status !== 'SENT';
      if (greeting?.ok === false) return true;
      if (Array.isArray(greeting?.errors) && greeting.errors.length) return true;
      return false;
    });

    if (failures.length) {
      console.log('Detected greeting delivery failures. Inspect the related send attempts above for feature flag or transport errors.');
    }

    expect(failures.length).toBe(0);
  });
});

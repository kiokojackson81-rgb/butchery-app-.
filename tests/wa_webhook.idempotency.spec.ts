import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock prisma waMessageLog interactions to observe dedupe behavior
vi.mock('@/lib/prisma', () => {
  const waMessageLog = {
    findFirst: vi.fn(async (q: any) => null),
    create: vi.fn(async (args: any) => ({ id: 'log1', ...(args?.data || {}) })),
  };
  return { prisma: { waMessageLog } } as any;
});

import { POST } from '@/app/api/wa/webhook/route';
import { prisma } from '@/lib/prisma';

function hmacHeader(secret: string, body: string) {
  const mac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${mac}`;
}

describe('wa webhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WA_DRY_RUN = 'false';
  });

  it('ignores duplicate messages with same wamid', async () => {
    const appSecret = 'testsecret';
    process.env.WHATSAPP_APP_SECRET = appSecret;

    const phone = '+254700000000';
    const fromGraph = phone.replace(/^\+/, '');
    const wamid = `wamid.12345`;
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: wamid, from: fromGraph, type: 'text', text: { body: 'hello' } }] } }] }] };
    const body = JSON.stringify(payload);
    const sig = hmacHeader(appSecret, body);

    // First call: should create one or more waMessageLog entries
    const oldEnv = (process as any).env.NODE_ENV;
    try {
      // Temporarily force production so the webhook handler uses DB-logging paths
      (process as any).env.NODE_ENV = 'production';
      var r1 = await POST(new Request('http://localhost/api/wa/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body } as any) as any);
    } finally {
      (process as any).env.NODE_ENV = oldEnv;
    }
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
  expect((prisma as any).waMessageLog.create).toHaveBeenCalled();
  // Record how many create calls were made after the first request
  const createsAfterFirst = (prisma as any).waMessageLog.create.mock.calls.length;

    // Second call: simulate existing waMessageLog entry found -> should be ignored
    (prisma as any).waMessageLog.findFirst.mockResolvedValueOnce({ id: 'log1' });
    try {
      (process as any).env.NODE_ENV = 'production';
      var r2 = await POST(new Request('http://localhost/api/wa/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body } as any) as any);
    } finally {
      (process as any).env.NODE_ENV = oldEnv;
    }
    const j2 = await r2.json();
    expect(j2.ok).toBe(true);

  // Ensure no additional create calls were made for the duplicate webhook
  expect((prisma as any).waMessageLog.create.mock.calls.length).toBe(createsAfterFirst);
  });
});

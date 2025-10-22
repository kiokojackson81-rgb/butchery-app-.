import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// We'll mock prisma waMessageLog interactions to observe dedupe behavior
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
  beforeEach(() => { vi.clearAllMocks(); process.env.WA_DRY_RUN = 'false'; });

  it('ignores duplicate messages with same wamid', async () => {
    const appSecret = 'testsecret';
    process.env.WHATSAPP_APP_SECRET = appSecret;

    const phone = '+254700000000';
    const fromGraph = phone.replace(/^\+/, '');
    const wamid = `wamid.12345`;
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: wamid, from: fromGraph, type: 'text', text: { body: 'hello' } }] } }] }] });
    const sig = hmacHeader(appSecret, body);

    // First call: should create a waMessageLog (our mock create will be called)
    const r1 = await POST(new Request('http://localhost/api/wa/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body } as any) as any);
    expect((prisma as any).waMessageLog.create).toHaveBeenCalled();

    // Make findFirst return a row for the same in_reply_to to simulate already-seen
    (prisma as any).waMessageLog.findFirst.mockResolvedValueOnce({ id: 'log1', payload: { in_reply_to: wamid } });

    // Second call: should be ignored (no additional create)
    const r2 = await POST(new Request('http://localhost/api/wa/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body } as any) as any);

    // findFirst should have been called to check in_reply_to; create should not be called again
    expect((prisma as any).waMessageLog.findFirst).toHaveBeenCalled();
    // create called only once overall
    expect((prisma as any).waMessageLog.create).toHaveBeenCalledTimes(1);
  });
});

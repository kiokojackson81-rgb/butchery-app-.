import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Provide a lightweight prisma mock to avoid DB connections during unit tests
const prismaMock = new Proxy({}, { get: (_, prop) => ({ findFirst: async () => null, findUnique: async () => null, findMany: async () => [], update: async () => null, upsert: async () => null, create: async () => null, deleteMany: async () => null, $transaction: async (fn: any) => typeof fn === 'function' ? await fn(prismaMock) : null }) });
vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));

import * as route from '@/app/api/wa/webhook/route';
import * as wa from '@/lib/wa';
import * as attendant from '@/server/wa_attendant_flow';
import * as supervisor from '@/server/wa/wa_supervisor_flow';
import * as supplier from '@/server/wa/wa_supplier_flow';

// Small helpers to build Graph webhook bodies
function makeMessage(from: string, body: any) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [body],
            },
          },
        ],
      },
    ],
  };
}

describe('wa webhook interactive routing', () => {
  let origSendText: any;
  let origSendInteractive: any;

  beforeEach(() => {
    origSendText = wa.sendText;
    origSendInteractive = wa.sendInteractive;
    vi.spyOn(wa, 'sendText').mockResolvedValue(null as any);
    vi.spyOn(wa, 'sendInteractive').mockResolvedValue(null as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes interactive button id to attendant handler', async () => {
    const spy = vi.spyOn(attendant, 'handleAuthenticatedInteractive').mockResolvedValue(undefined as any);
    // Ensure webhook treats this phone as authenticated attendant
    vi.spyOn(attendant, 'ensureAuthenticated').mockResolvedValue({ ok: true, sess: { role: 'attendant', code: 'A1', outlet: 'TestOutlet', phoneE164: '+254700000001' } } as any);

    const body = makeMessage('254700000001', {
      id: 'wamid.1',
      from: '254700000001',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'ATT_CLOSING', title: 'Close' } },
    });

    // Call the route POST directly
    const req = new Request('https://example.com/api/wa/webhook', { method: 'POST', body: JSON.stringify(body) });
    await route.POST(req as any);

    expect(spy).toHaveBeenCalled();
  });

  it('routes numeric text to attendant flow via digit mapping', async () => {
    const spy = vi.spyOn(attendant, 'handleAuthenticatedInteractive').mockResolvedValue(undefined as any);
    vi.spyOn(attendant, 'ensureAuthenticated').mockResolvedValue({ ok: true, sess: { role: 'attendant', code: 'A2', outlet: 'TestOutlet', phoneE164: '+254700000002' } } as any);

    const body = makeMessage('254700000002', {
      id: 'wamid.2',
      from: '254700000002',
      type: 'text',
      text: { body: '1' },
    });

    const req = new Request('https://example.com/api/wa/webhook', { method: 'POST', body: JSON.stringify(body) });
    await route.POST(req as any);

    expect(spy).toHaveBeenCalled();
  });

  it('routes supervisor interactive to supervisor handler', async () => {
    const spy = vi.spyOn(supervisor, 'handleSupervisorAction').mockResolvedValue(undefined as any);
    // For supervisor test, ensure auth returns supervisor role
    vi.spyOn(attendant, 'ensureAuthenticated').mockResolvedValue({ ok: true, sess: { role: 'supervisor', code: 'S1', outlet: null, phoneE164: '+254700000010' } } as any);

    const body = makeMessage('254700000010', {
      id: 'wamid.10',
      from: '254700000010',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'SUP_REVIEW', title: 'Review' } },
    });

    const req = new Request('https://example.com/api/wa/webhook', { method: 'POST', body: JSON.stringify(body) });
    await route.POST(req as any);

    expect(spy).toHaveBeenCalled();
  });

  it('routes supplier interactive to supplier handler', async () => {
    const spy = vi.spyOn(supplier, 'handleSupplierAction').mockResolvedValue(undefined as any);
    vi.spyOn(attendant, 'ensureAuthenticated').mockResolvedValue({ ok: true, sess: { role: 'supplier', code: 'SUP1', outlet: null, phoneE164: '+254700000020' } } as any);

    const body = makeMessage('254700000020', {
      id: 'wamid.20',
      from: '254700000020',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'SPL_RECENT', title: 'Recent' } },
    });

    const req = new Request('https://example.com/api/wa/webhook', { method: 'POST', body: JSON.stringify(body) });
    await route.POST(req as any);

    expect(spy).toHaveBeenCalled();
  });
});

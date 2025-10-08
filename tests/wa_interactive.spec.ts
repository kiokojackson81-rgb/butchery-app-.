import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/notify/supply/route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    phoneMapping: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
  },
}));

vi.mock('@/lib/wa_supply_notify', () => ({
  notifySupplyMultiRole: vi.fn(async ({ payload, phones, templates }) => ({ ok: true, results: { test: { payload, phones, templates } } })),
}));

describe('POST /api/notify/supply', () => {
  const basePayload = {
    payload: {
      outlet: 'Outlet A',
      ref: 'REF1',
      dateISO: new Date().toISOString(),
      supplierName: 'Supp',
      attendantName: 'Att',
      items: [ { name: 'Beef', qty: 5, unit: 'kg', unitPrice: 500 } ]
    }
  };

  beforeEach(() => {
    (process as any).env.INTERNAL_API_KEY = 'secret';
    (process as any).env.SUPPLY_TEMPLATE_ATTENDANT = 'tmpl_att';
    (process as any).env.SUPPLY_TEMPLATE_SUPERVISOR = 'tmpl_sup';
  });

  it('rejects when missing internal key', async () => {
    const req = new Request('http://localhost/api/notify/supply', { method: 'POST', body: JSON.stringify(basePayload) });
    const res = await POST(req as any);
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('accepts with key and injects env templates', async () => {
    const req = new Request('http://localhost/api/notify/supply', { method: 'POST', body: JSON.stringify(basePayload), headers: { 'x-internal-key': 'secret' } });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.ok).toBe(true);
  });
});

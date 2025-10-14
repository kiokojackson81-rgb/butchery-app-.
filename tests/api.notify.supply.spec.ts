import { describe, it, expect, vi, beforeAll } from 'vitest';
import { notifySupplyMultiRole } from '@/lib/wa_supply_notify';

vi.mock('@/lib/wa', () => ({
  sendTextSafe: vi.fn(async (phone: string, text: string) => ({ ok: true, phone, text })),
  sendTemplate: vi.fn(async (opts: any) => ({ ok: true, template: opts.template, to: opts.to })),
}));

describe('notifySupplyMultiRole', () => {
  it('sends attendant and supervisor messages (mocked)', async () => {
    const res = await notifySupplyMultiRole({
      payload: {
        outlet: 'Outlet A',
        ref: 'REF1',
        dateISO: new Date().toISOString(),
        supplierName: 'Supplier',
        attendantName: 'Attendant',
        items: [ { name: 'Beef', qty: 10, unit: 'kg', unitPrice: 500 } ]
      },
      phones: { attendant: '+254700000001', supervisor: '+254700000002' },
      templates: { attendant: 'supply_attendant', supervisor: 'supply_supervisor' }
    });
    expect(res.ok).toBe(true);
    expect(res.results.attendant.ok).toBe(true);
  });
});

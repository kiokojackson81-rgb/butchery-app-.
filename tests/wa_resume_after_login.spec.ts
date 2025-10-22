import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    personCode: { findFirst: vi.fn(), findUnique: vi.fn() },
    phoneMapping: { findUnique: vi.fn(), create: vi.fn() },
    waSession: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    attendantScope: { findUnique: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(async () => null) },
  }
}));

vi.mock('@/lib/wa', () => ({
  sendText: vi.fn().mockResolvedValue(null),
  sendInteractive: vi.fn().mockResolvedValue(null),
  logOutbound: vi.fn(),
}));

vi.mock('@/lib/wa/state', () => ({
  getWaState: vi.fn(async () => ({})),
  updateWaState: vi.fn(async () => ({})),
}));

// Minimal server helpers used by bindPhoneAndEnterMenu path
vi.mock('@/server/products', () => ({ getAssignedProducts: vi.fn(async () => []) }));

import { handleInboundText } from '@/lib/wa_attendant_flow';

describe('resume after login (LINK) flows', () => {
  beforeEach(async () => {
    const { prisma } = await import('@/lib/prisma');
    // personCode lookups
    (prisma as any).personCode.findUnique.mockResolvedValue({ code: 'ATT004', role: 'attendant', active: true });
    (prisma as any).personCode.findFirst.mockResolvedValue({ code: 'ATT004', role: 'attendant', active: true });

    // phoneMapping: map code -> outlet (pretend assigned)
    (prisma as any).phoneMapping.findUnique.mockImplementation(async ({ where }: any) => {
      if (where && where.code === 'ATT004') return { code: 'ATT004', phoneE164: null, outlet: 'TestOutlet' };
      return null;
    });

    // When asked for the link session (phoneE164 = '+LINK:ABC123') return a session with a cursor
    (prisma as any).waSession.findUnique.mockImplementation(async ({ where }: any) => {
      if (!where) return null;
      const ph = where.phoneE164;
      if (ph === '+LINK:ABC123') {
        return { phoneE164: ph, code: 'ATT004', role: 'attendant', cursor: { date: '2025-10-12', currentItem: { key: 'goat', name: 'Goat' }, rows: [] } };
      }
      // Simulate that the real phone already has the same cursor (e.g., link flow copied it)
      if (ph === '+254700000004') return { id: 'sess', phoneE164: ph, code: 'ATT004', role: 'attendant', outlet: 'TestOutlet', cursor: { date: '2025-10-12', currentItem: { key: 'goat', name: 'Goat' }, rows: [] }, updatedAt: new Date().toISOString() };
      return null;
    });

    (prisma as any).waSession.create.mockResolvedValue({ id: 'sess' });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });
    (prisma as any).waSession.upsert.mockResolvedValue({ id: 'sess' });
    (prisma as any).waSession.delete.mockResolvedValue(undefined);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('resumes into quantity prompt (CLOSING_QTY) when cursor.currentItem exists', async () => {
    const wa = await import('@/lib/wa');
    const { prisma } = await import('@/lib/prisma');

    // Call inbound text that triggers the LINK <nonce> flow
    await handleInboundText('+254700000004', 'LINK ABC123');

    // Expect sendText to have been called to resume the quantity prompt
    expect((wa.sendText as any).mock.calls.length).toBeGreaterThan(0);
    const texts = (wa.sendText as any).mock.calls.map((c: any) => c[1]);
    const hasQtyPrompt = texts.some((t: string) => /enter/i.test(t) && /goat|goat/i.test(t.toLowerCase()) || /quantity/i.test(t.toLowerCase()));
    expect(hasQtyPrompt).toBe(true);

    // Ensure the session was updated to CLOSING_QTY via waSession.update (saveSession path)
    const updates = (prisma as any).waSession.update.mock.calls.map((c: any) => c?.[1] || c?.[0] || {});
    // At least one call should include data with state: 'CLOSING_QTY' or data.state === 'CLOSING_QTY'
    const updatedToClosingQty = (prisma as any).waSession.update.mock.calls.some((call: any) => {
      const data = call?.[1]?.data || call?.[0]?.data || call?.[0];
      if (!data) return false;
      const d = data.state || (data && data.state === undefined ? undefined : data);
      // check direct state patch as well
      return (data && (data.state === 'CLOSING_QTY' || (data.state && data.state === 'CLOSING_QTY')))
        || (data && data.state === 'CLOSING_QTY')
        || JSON.stringify(data).includes('CLOSING_QTY');
    });
    expect(updatedToClosingQty).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    personCode: { findFirst: vi.fn(), findUnique: vi.fn() },
    phoneMapping: { findUnique: vi.fn(), create: vi.fn() },
  waSession: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), upsert: vi.fn(), delete: vi.fn(async () => null) },
    attendantScope: { findUnique: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    attendantExpense: { findFirst: vi.fn(), count: vi.fn() },
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

vi.mock('@/server/products', () => ({ getAssignedProducts: vi.fn(async () => []) }));

import { handleInboundText } from '@/lib/wa_attendant_flow';

describe('resume variants after login', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('resumes to SUMMARY when cursor.rows exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).personCode.findUnique.mockResolvedValue({ code: 'ATT010', role: 'attendant', active: true });
    (prisma as any).personCode.findFirst.mockResolvedValue({ code: 'ATT010', role: 'attendant', active: true });
    (prisma as any).phoneMapping.findUnique.mockResolvedValue({ code: 'ATT010', phoneE164: null, outlet: 'OutletX' });
    (prisma as any).waSession.findUnique.mockImplementation(async ({ where }: any) => {
      const ph = where?.phoneE164;
      if (ph === '+LINK:SUM1') return { phoneE164: ph, code: 'ATT010', role: 'attendant', cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'Goat', closing: 5 }] } };
      if (ph === '+254700000010') return { id: 'sess', phoneE164: ph, code: 'ATT010', role: 'attendant', outlet: 'OutletX', cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'Goat', closing: 5 }] }, updatedAt: new Date().toISOString() };
      return null;
    });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });

    const wa = await import('@/lib/wa');
    await handleInboundText('+254700000010', 'LINK SUM1');

    // Expect sendText called with the review summary text
    const texts = (wa.sendText as any).mock.calls.map((c: any) => c[1]);
    const foundSummary = texts.some((t: string) => /Summary/i.test(t) || /closing/i.test(t) || /goat/i.test(t.toLowerCase()));
    expect(foundSummary).toBe(true);
  });

  it('resumes to EXPENSE_AMOUNT when cursor.expenseName exists', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).personCode.findUnique.mockResolvedValue({ code: 'ATT011', role: 'attendant', active: true });
    (prisma as any).personCode.findFirst.mockResolvedValue({ code: 'ATT011', role: 'attendant', active: true });
    (prisma as any).phoneMapping.findUnique.mockResolvedValue({ code: 'ATT011', phoneE164: null, outlet: 'OutletY' });
    (prisma as any).waSession.findUnique.mockImplementation(async ({ where }: any) => {
      const ph = where?.phoneE164;
      if (ph === '+LINK:EXP1') return { phoneE164: ph, code: 'ATT011', role: 'attendant', cursor: { date: '2025-10-12', expenseName: 'Ice' } };
      if (ph === '+254700000011') return { id: 'sess', phoneE164: ph, code: 'ATT011', role: 'attendant', outlet: 'OutletY', cursor: { date: '2025-10-12', expenseName: 'Ice' }, updatedAt: new Date().toISOString() };
      return null;
    });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });

    const wa = await import('@/lib/wa');
    await handleInboundText('+254700000011', 'LINK EXP1');

    // Expect sendText asked for amount for the expense name
    const texts = (wa.sendText as any).mock.calls.map((c: any) => c[1]);
    const asksForAmount = texts.some((t: string) => /Enter amount for/i.test(t) || /numbers only/i.test(t) || /250/i.test(t));
    expect(asksForAmount).toBe(true);
  });
});

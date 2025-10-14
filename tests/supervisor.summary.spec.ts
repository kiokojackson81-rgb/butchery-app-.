import { describe, expect, it, vi } from 'vitest';

// Build a minimal prisma mock with only methods used by computeSummaryText
const fakePrisma = {
  attendantClosing: { count: vi.fn() },
  attendantExpense: { findMany: vi.fn() },
  attendantDeposit: { findMany: vi.fn() },
  supplyOpeningRow: { count: vi.fn() },
  outletPerformance: { findUnique: vi.fn(), findMany: vi.fn() },
  attendantKPI: { findMany: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: fakePrisma as any }));

describe('computeSummaryText', () => {
  it('single outlet: includes commission and top performers', async () => {
    // Arrange
    fakePrisma.attendantClosing.count.mockResolvedValueOnce(3);
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([{ amount: 200 }, { amount: 300 }]);
    fakePrisma.attendantDeposit.findMany.mockResolvedValueOnce([{ amount: 1200 }, { amount: 800 }]);
    fakePrisma.supplyOpeningRow.count.mockResolvedValueOnce(2);
    fakePrisma.outletPerformance.findUnique.mockResolvedValueOnce({ totalCommission: 450 });
    fakePrisma.attendantKPI.findMany.mockResolvedValueOnce([
      { totalWeight: 30, commissionAmount: 250, attendant: { name: 'Musyoki' } },
      { totalWeight: 28, commissionAmount: 300, attendant: { name: 'Wanjiru' } },
    ]);

    const { computeSummaryText } = await import('@/server/wa/wa_supervisor_flow');

    // Act
    const text = await computeSummaryText('2025-10-10', 'Baraka A');

    // Assert
    expect(text).toMatch(/Baraka A • 2025-10-10/);
    expect(text).toMatch(/Deliveries: 2/);
    expect(text).toMatch(/Closings: 3/);
    expect(text).toMatch(/Expenses: KSh 500/);
    expect(text).toMatch(/Deposits: KSh 2000/);
    expect(text).toMatch(/Commission: KSh 450/);
    expect(text).toMatch(/Top weight: Musyoki — 30\.0 kg/);
    expect(text).toMatch(/Top commission: Wanjiru — KSh 300/);
  });

  it('all outlets: sums commission across performances; falls back to KPIs if zero', async () => {
    // Arrange
    fakePrisma.attendantClosing.count.mockResolvedValueOnce(6); // not used in asserts
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([]);
    fakePrisma.attendantDeposit.findMany.mockResolvedValueOnce([]);
    fakePrisma.supplyOpeningRow.count.mockResolvedValueOnce(4);
    fakePrisma.outletPerformance.findMany.mockResolvedValueOnce([{ totalCommission: 300 }, { totalCommission: 200 }]);
    fakePrisma.attendantKPI.findMany.mockResolvedValueOnce([
      { totalWeight: 10, commissionAmount: 0, attendant: { name: 'A' } },
      { totalWeight: 12, commissionAmount: 0, attendant: { name: 'B' } },
    ]);

    const { computeSummaryText } = await import('@/server/wa/wa_supervisor_flow');

    // Act
    const text = await computeSummaryText('2025-10-10');

    // Assert
    expect(text).toMatch(/All Outlets • 2025-10-10/);
    expect(text).toMatch(/Deliveries: 4/);
    expect(text).toMatch(/Commission: KSh 500/);
  });
});

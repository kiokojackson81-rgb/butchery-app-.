// tests/finance.snapshot.synthetic-opening.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeSnapshotTotals } from '@/server/finance';

// Mock prisma used inside computeSnapshotTotals
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      pricebookRow: { findMany: vi.fn(async () => ([{ productKey: 'beef', sellPrice: 500, active: true }])) },
      product: { findMany: vi.fn(async () => ([{ key: 'beef', sellPrice: 500, active: true }])) },
    }
  };
});

describe('computeSnapshotTotals synthetic opening fallback', () => {
  beforeEach(() => {
    // Clear mocks if needed
  });

  it('derives opening from closings when openingSnapshot empty and produces non-zero expectedSales', async () => {
    const closings = [ { itemKey: 'beef', closingQty: 10, wasteQty: 2 } ];
    const res = await computeSnapshotTotals({
      outletName: 'OutletX',
      openingSnapshot: {}, // empty triggers synthetic fallback
      closings,
      expenses: [{ amount: 0 }],
      deposits: []
    });
    // Synthetic opening should be closing + waste = 12, soldQty = opening - closing = 2 * price(500) = 1000 expectedSales
    expect(res.expectedSales).toBeGreaterThan(0);
    expect(res.expectedSales).toBe(1000); // 2 * 500
    expect(res.potatoesExpectedDeposit).toBe(0); // not potatoes key
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declare the prisma mock at module scope so vitest's hoisted vi.mock factory
// can reference it. We'll assign/reset implementations in beforeEach.
var prismaMock: any = {
  attendantDeposit: { findFirst: vi.fn(), create: vi.fn() },
};

// Hoisted mock factory must be declared before any import that loads modules
// which in turn import '@/lib/prisma'. This ensures the mocked prisma is used.
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// We'll dynamically import functions from modules that use prisma after the
// mocks are installed to avoid ESM import hoisting issues.

describe('parseMpesaText', () => {
  it('parses common M-Pesa SMS', () => {
    const s = 'Your M-PESA payment of Ksh 1,200.00 received. STAN: ABCDEFGHIJ';
    // import dynamically to avoid hoisted mock interference
    return import('@/server/deposits').then(({ parseMpesaText }) => {
      const p = parseMpesaText(s);
      expect(p).not.toBeNull();
      expect(p?.amount).toBe(1200);
      expect(typeof p?.ref).toBe('string');
    });
  });
});

describe('addDeposit idempotency (mocked prisma)', () => {
  beforeEach(() => {
    // Reset mocks before each test
    prismaMock.attendantDeposit.findFirst = vi.fn();
    prismaMock.attendantDeposit.create = vi.fn();
  });

  it('creates when none exists, and returns existing on second call', async () => {
    // Setup: first findFirst returns null, create returns created row
    prismaMock.attendantDeposit.findFirst.mockResolvedValueOnce(null);
    prismaMock.attendantDeposit.create.mockResolvedValueOnce({ id: 'c1', amount: 500 });

    // Dynamically import function after mocking
    const { addDeposit } = await import('@/server/deposits');
    const created = await addDeposit({ outletName: 'OutletA', amount: 500, note: 'ref1' });
    expect(created).toEqual({ id: 'c1', amount: 500 });

    // Now simulate that findFirst finds existing row
    prismaMock.attendantDeposit.findFirst.mockResolvedValueOnce({ id: 'c1', amount: 500 });
    const again = await addDeposit({ outletName: 'OutletA', amount: 500, note: 'ref1' });
    expect(again).toEqual({ id: 'c1', amount: 500 });
  });
});

// saveClosings uses prisma.$transaction; mock it to ensure upsert called
describe('saveClosings (mocked transaction)', () => {
  it('calls upsert for each row', async () => {
    const upsert = vi.fn().mockResolvedValue(true);
    // Reuse the top-level prismaMock by setting its $transaction method.
    prismaMock.$transaction = vi.fn(async (fn: any) => fn({ attendantClosing: { upsert } }));
    const { saveClosings } = await import('@/server/closings');
  // Use zero closings so validation (closing <= openingEffective - waste) passes with unknown openingEffective (assumed 0)
  const rows = [{ productKey: 'X', closingQty: 0, wasteQty: 0 }, { productKey: 'Y', closingQty: 0, wasteQty: 0 }];
    await saveClosings({ date: '2025-10-09', outletName: 'OutletA', rows });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

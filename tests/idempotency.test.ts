import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test parseMpesaText (pure function)
import { parseMpesaText, addDeposit as realAddDeposit } from '@/server/deposits';
import { saveClosings as realSaveClosings } from '@/server/closings';

describe('parseMpesaText', () => {
  it('parses common M-Pesa SMS', () => {
    const s = 'Your M-PESA payment of Ksh 1,200.00 received. STAN: ABCDEFGHIJ';
    const p = parseMpesaText(s);
    expect(p).not.toBeNull();
    expect(p?.amount).toBe(1200);
    expect(typeof p?.ref).toBe('string');
  });
});

describe('addDeposit idempotency (mocked prisma)', () => {
  let prismaMock: any;
  beforeEach(() => {
    prismaMock = {
      attendantDeposit: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    // Replace the real prisma import with our mock for the module under test
    vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
    // We must re-import the module under test to pick up the mock
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // Note: using require here to avoid static ESM import binding issues when mocking
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
    const prismaMock: any = { $transaction: vi.fn(async (fn: any) => fn({ attendantClosing: { upsert } })) };
    vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
    const { saveClosings } = await import('@/server/closings');
    const rows = [{ productKey: 'X', closingQty: 2, wasteQty: 0 }, { productKey: 'Y', closingQty: 3, wasteQty: 1 }];
    await saveClosings({ date: '2025-10-09', outletName: 'OutletA', rows });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal prisma mock
const fakePrisma: any = {
  supplyOpeningRow: { findMany: vi.fn() },
  attendantClosing: { findMany: vi.fn() },
  pricebookRow: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  attendantExpense: { findMany: vi.fn() },
  attendantDeposit: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  setting: { findUnique: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

// Control today() so isCurrent logic is deterministic
vi.mock('@/server/trading_period', async (orig) => {
  const mod: any = await orig();
  return {
    ...mod,
    APP_TZ: 'Africa/Nairobi',
    dateISOInTZ: () => '2025-10-10', // pretend today
    addDaysISO: (d: string, n: number) => {
      const dt = new Date(`${d}T00:00:00.000Z`);
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0,10);
    },
  };
});

function makeReq(url: string) {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  // default raw query to empty array to avoid undefined in some DB mocks
  fakePrisma.$queryRaw.mockResolvedValue([]);
    // default findMany to empty arrays to avoid undefined
    fakePrisma.supplyOpeningRow.findMany.mockResolvedValue([]);
    fakePrisma.attendantClosing.findMany.mockResolvedValue([]);
    fakePrisma.pricebookRow.findMany.mockResolvedValue([]);
    fakePrisma.product.findMany.mockResolvedValue([]);
    fakePrisma.attendantExpense.findMany.mockResolvedValue([]);
    fakePrisma.attendantDeposit.findMany.mockResolvedValue([]);
});

describe('/api/metrics/header snapshot behavior', () => {
  it('Current with no activity: returns carryover from snapshot (amountToDeposit = carryover)', async () => {
    const outlet = 'TestOutlet';
    const date = '2025-10-10'; // mocked today

    // No live activity for current day
    fakePrisma.supplyOpeningRow.findMany.mockResolvedValueOnce([]); // openRows
    fakePrisma.attendantClosing.findMany.mockResolvedValueOnce([]); // closingRows
  // Ensure pricebook/product data is returned for all internal calls
  fakePrisma.pricebookRow.findMany.mockResolvedValue([{ outletName: outlet, productKey: 'beef', sellPrice: 1000, active: true }]);
  fakePrisma.product.findMany.mockResolvedValue([{ key: 'beef', name: 'Beef', unit: 'kg', sellPrice: 1000, active: true }]);
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([]); // expenses
    fakePrisma.attendantDeposit.findMany.mockResolvedValueOnce([]); // deposits
    fakePrisma.$queryRaw.mockResolvedValueOnce([]); // till count
    // Snapshots for current date
    const snapshot = {
      openingSnapshot: { beef: 10 },
      closings: [{ itemKey: 'beef', closingQty: 2, wasteQty: 1 }],
      expenses: [{ amount: 100 }],
    };
    fakePrisma.setting.findUnique
      .mockResolvedValueOnce({ key: `snapshot:closing:${date}:${outlet}:1`, value: snapshot }) // snap1
      .mockResolvedValueOnce(null); // snap2

    // Previous day (y=2025-10-09) carryover baseline (set to zero to isolate snapshot logic)
    fakePrisma.supplyOpeningRow.findMany.mockResolvedValueOnce([]); // y openRows
    fakePrisma.attendantClosing.findMany.mockResolvedValueOnce([]); // y closings
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([]); // y expenses
    fakePrisma.attendantDeposit.findMany.mockResolvedValueOnce([]); // y deposits

    const { GET } = await import('@/app/api/metrics/header/route');
    const res = await GET(makeReq(`https://x/api/metrics/header?outlet=${encodeURIComponent(outlet)}`));
    const j = await (res as any).json();
    if (j && j.totals && Number(j.totals.weightSales) === 0) {
      console.error('[metrics debug] previous view totals', j.totals);
    }
    // Debugging: surface response when tests fail to help diagnose missing mocks
    if (!(j && j.ok)) {
      console.error('[metrics debug] response', j);
    }

    // From snapshot: sold = 10 - 2 - 1 = 7; sales = 7*1000 = 7000; expenses=100; deposits=0
    // carryoverPrev = 7000 - 100 - 0 = 6900; amountToDeposit = carryoverPrev (because current has no activity)
    expect(j.ok).toBe(true);
    expect(j.totals.carryoverPrev).toBe(6900);
    expect(j.totals.amountToDeposit).toBe(6900);
    expect(j.totals.weightSales).toBe(0); // current period totals are gated to zero
  });

  it('Previous view (date explicit) uses snapshot for totals', async () => {
    const outlet = 'TestOutlet';
    const date = '2025-10-10'; // request previous period view for this date

    // For this request, the first 7 calls correspond to date-scoped queries
    fakePrisma.supplyOpeningRow.findMany.mockResolvedValueOnce([]); // openRows (date)
    fakePrisma.attendantClosing.findMany.mockResolvedValueOnce([]); // closingRows (date)
  // Ensure pricebook/product data is returned for all internal calls
  fakePrisma.pricebookRow.findMany.mockResolvedValue([{ outletName: outlet, productKey: 'beef', sellPrice: 1000, active: true }]);
  fakePrisma.product.findMany.mockResolvedValue([{ key: 'beef', name: 'Beef', unit: 'kg', sellPrice: 1000, active: true }]);
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([]); // expenses (date)
  // Route uses $queryRaw for deposits; return the deposit row first, then till count
  fakePrisma.$queryRaw.mockResolvedValueOnce([{ amount: 500, status: 'VALID' }]); // deposits (date)
  fakePrisma.$queryRaw.mockResolvedValueOnce([]); // till count
    // Snapshots for this date
    const snapshot = {
      openingSnapshot: { beef: 10 },
      closings: [{ itemKey: 'beef', closingQty: 2, wasteQty: 1 }],
      expenses: [{ amount: 100 }],
    };
    fakePrisma.setting.findUnique
      .mockResolvedValueOnce({ key: `snapshot:closing:${date}:${outlet}:1`, value: snapshot }) // snap1
      .mockResolvedValueOnce(null); // snap2

    // Previous day for carryover (y): set to zero so outstandingPrev = 0
    fakePrisma.supplyOpeningRow.findMany.mockResolvedValueOnce([]); // y openRows
    fakePrisma.attendantClosing.findMany.mockResolvedValueOnce([]); // y closings
    fakePrisma.attendantExpense.findMany.mockResolvedValueOnce([]); // y expenses
    fakePrisma.attendantDeposit.findMany.mockResolvedValueOnce([]); // y deposits

    const { GET } = await import('@/app/api/metrics/header/route');
    const res = await GET(makeReq(`https://x/api/metrics/header?outlet=${encodeURIComponent(outlet)}&date=${date}`));
    const j = await (res as any).json();

    // Snapshot totals for this date: sales 7000, expenses 100, deposits 500
    // todayTotalPrev = 6900; amountToDepositPrev = outstandingPrev(0) + 6900 - 500 = 6400
    expect(j.ok).toBe(true);
    expect(j.totals.weightSales).toBe(7000);
    expect(j.totals.expenses).toBe(100);
    expect(j.totals.verifiedDeposits).toBe(500);
    expect(j.totals.todayTotalSales).toBe(6900);
    expect(j.totals.amountToDeposit).toBe(6400);
  });
});

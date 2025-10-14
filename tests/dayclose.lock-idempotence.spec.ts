import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mocks
const fakePrisma = {
  dayClosePeriod: { upsert: vi.fn() },
  attendantKPI: { findMany: vi.fn() },
  attendant: { findUnique: vi.fn() },
  phoneMapping: { findUnique: vi.fn(), findMany: vi.fn() },
  outletPerformance: { findUnique: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: fakePrisma as any }));

const fns = {
  computeOutletPerformance: vi.fn(),
  computeAllAttendantKPIs: vi.fn(),
  buildDailyProductSupplyStats: vi.fn(),
  computeSupplyRecommendations: vi.fn(),
  nightlyRecalcOpenIntervals: vi.fn(),
  closeOpenSupplyIntervalsIfNeeded: vi.fn(),
};
vi.mock('@/lib/analytics/performance.service', () => ({
  computeOutletPerformance: fns.computeOutletPerformance,
  computeAllOutletsPerformance: vi.fn(),
}));
vi.mock('@/lib/analytics/attendant-kpi.service', () => ({
  computeAllAttendantKPIs: fns.computeAllAttendantKPIs,
}));
vi.mock('@/lib/analytics/supply-insights.service', () => ({
  buildDailyProductSupplyStats: fns.buildDailyProductSupplyStats,
  computeSupplyRecommendations: fns.computeSupplyRecommendations,
}));
vi.mock('@/lib/analytics/intervals.service', () => ({
  nightlyRecalcOpenIntervals: fns.nightlyRecalcOpenIntervals,
  closeOpenSupplyIntervalsIfNeeded: fns.closeOpenSupplyIntervalsIfNeeded,
}));

const wa = { sendTextSafe: vi.fn() };
vi.mock('@/lib/wa', () => ({ sendTextSafe: wa.sendTextSafe, getPhoneByCode: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  fakePrisma.attendantKPI.findMany.mockResolvedValue([]);
  fakePrisma.attendant.findUnique.mockResolvedValue(null);
  fakePrisma.phoneMapping.findUnique.mockResolvedValue(null);
  fakePrisma.phoneMapping.findMany.mockResolvedValue([]);
  fakePrisma.outletPerformance.findUnique.mockResolvedValue({ totalCommission: 0 });
});

describe('lockDay idempotence / side effects', () => {
  it('calls compute pipeline consistently and can be invoked twice safely', async () => {
    const { lockDay } = await import('@/lib/analytics/day-close.service');

    const outlet = 'Baraka A';
    const date = new Date('2025-10-10T12:00:00Z');

    await lockDay(outlet, date, 'tester');
    await lockDay(outlet, date, 'tester');

    // Per call, computeOutletPerformance is invoked twice (before and after KPIs)
    expect(fns.computeOutletPerformance).toHaveBeenCalledTimes(4);
    expect(fns.computeAllAttendantKPIs).toHaveBeenCalledTimes(2);
    expect(fns.buildDailyProductSupplyStats).toHaveBeenCalledTimes(2);
    expect(fns.computeSupplyRecommendations).toHaveBeenCalledTimes(2);
    expect(fns.nightlyRecalcOpenIntervals).toHaveBeenCalledTimes(2);
    expect(fns.closeOpenSupplyIntervalsIfNeeded).toHaveBeenCalledTimes(2);

    // No attendant notifications (since no KPIs/phones mocked)
    expect(wa.sendTextSafe).not.toHaveBeenCalled();

  // Digest path does not throw; no recipients mocked
  // (we avoid asserting exact DB calls here to reduce brittleness)
  });
});

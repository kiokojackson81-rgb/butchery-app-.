import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const reviewItem = { findUnique: vi.fn(), update: vi.fn() };
  const attendantDeposit = { updateMany: vi.fn() };
  const supplyOpeningRow = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const $transaction = vi.fn(async (cb: any) => {
    // Provide a tx object exposing the same model shapes used by the service
    const tx = { reviewItem, attendantDeposit, supplyOpeningRow } as any;
    return cb(tx);
  });
  return { prisma: { reviewItem, attendantDeposit, supplyOpeningRow, $transaction } } as any;
});

vi.mock('@/server/supervisor/supervisor.notifications', () => ({
  notifyOriginator: vi.fn(),
  notifyAttendants: vi.fn(),
  notifySupplier: vi.fn(),
}));

vi.mock('@/server/supply_notify', () => ({ notifySupplyPosted: vi.fn() }));
vi.mock('@/server/finance', () => ({ computeDayTotals: vi.fn() }));

import { reviewItem } from '@/server/supervisor/review.service';
import { prisma } from '@/lib/prisma';

describe('reviewItem service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('approves a deposit review and updates attendantDeposit status', async () => {
    const item = { id: 'r1', status: 'pending', type: 'deposit', outlet: 'Outlet X', date: new Date().toISOString(), payload: { parsed: { ref: 'REF1' } } };
    (prisma as any).reviewItem.findUnique.mockResolvedValueOnce(item);
    (prisma as any).reviewItem.update.mockResolvedValueOnce({ ...item, status: 'approved' });
    (prisma as any).attendantDeposit.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await reviewItem({ id: 'r1', action: 'approve' }, 'SUP123');
    expect(res.ok).toBe(true);
    expect((prisma as any).attendantDeposit.updateMany).toHaveBeenCalled();
  });

  it('approves a supply_edit review and creates/updates supplyOpeningRow', async () => {
    const rows = [{ itemKey: 'beef', qty: 5, buyPrice: 200 }];
    const item = { id: 'r2', status: 'pending', type: 'supply_edit', outlet: 'Outlet Y', date: new Date().toISOString(), payload: { rows } };
    (prisma as any).reviewItem.findUnique.mockResolvedValueOnce(item);
    (prisma as any).reviewItem.update.mockResolvedValueOnce({ ...item, status: 'approved' });

    // supplyOpeningRow findUnique returns null first -> create called
    (prisma as any).supplyOpeningRow.findUnique.mockResolvedValueOnce(null);
    (prisma as any).supplyOpeningRow.create.mockResolvedValueOnce({ id: 's1', itemKey: 'beef', qty: 5 });

    const res = await reviewItem({ id: 'r2', action: 'approve' }, 'SUP123');
    expect(res.ok).toBe(true);
    expect((prisma as any).supplyOpeningRow.create).toHaveBeenCalled();
  });
});

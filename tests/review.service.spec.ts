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

  it('supply_edit preserves existing lock fields when updating a locked row', async () => {
    const rows = [{ itemKey: 'beef', qty: 9, buyPrice: 210 }];
    const item = { id: 'r3', status: 'pending', type: 'supply_edit', outlet: 'Outlet Z', date: '2025-11-12', payload: { rows } };
    (prisma as any).reviewItem.findUnique.mockResolvedValueOnce(item);
    (prisma as any).reviewItem.update.mockResolvedValueOnce({ ...item, status: 'approved' });

    // existing row already locked
    const existing = { id: 's9', itemKey: 'beef', qty: 5, buyPrice: 200, lockedAt: new Date('2025-11-12T06:00:00.000Z'), lockedBy: 'supplier_portal' };
    (prisma as any).supplyOpeningRow.findUnique.mockResolvedValueOnce(existing);
    (prisma as any).supplyOpeningRow.update.mockResolvedValueOnce({ ...existing, qty: 9, buyPrice: 210 });

    const res = await reviewItem({ id: 'r3', action: 'approve' }, 'SUP999');
    expect(res.ok).toBe(true);
    expect((prisma as any).supplyOpeningRow.update).toHaveBeenCalledTimes(1);
    const updateArgs = (prisma as any).supplyOpeningRow.update.mock.calls[0][0];
    // qty/buyPrice updated; lock fields preserved (not overwritten)
    expect(updateArgs.data.qty).toBe(9);
    expect(updateArgs.data.buyPrice).toBe(210);
    expect(updateArgs.data.lockedAt).toBe(existing.lockedAt); // stays as existing
    expect(updateArgs.data.lockedBy).toBe(existing.lockedBy);
  });

  it('supply_edit sets lock fields when updating an unlocked existing row', async () => {
    const rows = [{ itemKey: 'goat', qty: 12 }];
    const item = { id: 'r4', status: 'pending', type: 'supply_edit', outlet: 'Outlet W', date: '2025-11-12', payload: { rows } };
    (prisma as any).reviewItem.findUnique.mockResolvedValueOnce(item);
    (prisma as any).reviewItem.update.mockResolvedValueOnce({ ...item, status: 'approved' });

    // existing row without lock
    const existing = { id: 's10', itemKey: 'goat', qty: 0, buyPrice: 0, lockedAt: null, lockedBy: null };
    (prisma as any).supplyOpeningRow.findUnique.mockResolvedValueOnce(existing);
    (prisma as any).supplyOpeningRow.update.mockResolvedValueOnce({ ...existing, qty: 12, lockedAt: new Date(), lockedBy: 'supervisor_review' });

    const res = await reviewItem({ id: 'r4', action: 'approve' }, 'SUP888');
    expect(res.ok).toBe(true);
    expect((prisma as any).supplyOpeningRow.update).toHaveBeenCalledTimes(1);
    const updateArgs = (prisma as any).supplyOpeningRow.update.mock.calls[0][0];
    expect(updateArgs.data.qty).toBe(12);
    // lock fields should be set when previously null
    expect(updateArgs.data.lockedAt).toBeDefined();
    expect(updateArgs.data.lockedBy).toBe('supervisor_review');
  });
});

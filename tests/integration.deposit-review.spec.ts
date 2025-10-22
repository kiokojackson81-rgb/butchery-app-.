import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma and notifications
vi.mock('@/lib/prisma', () => {
  const attendantDeposit = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() };
  const reviewItem = { findUnique: vi.fn(), update: vi.fn() };
  const $transaction = vi.fn(async (cb: any) => cb({ reviewItem, attendantDeposit }));
  return { prisma: { attendantDeposit, reviewItem, $transaction } } as any;
});

vi.mock('@/server/supervisor/supervisor.notifications', () => ({
  notifyAttendants: vi.fn(), notifySupplier: vi.fn(), notifyOriginator: vi.fn(),
}));

vi.mock('@/server/supply_notify', () => ({ notifySupplyPosted: vi.fn() }));
vi.mock('@/server/finance', () => ({ computeDayTotals: vi.fn() }));

import * as depositsMod from '@/server/deposits';
import { reviewItem } from '@/server/supervisor/review.service';
import { prisma } from '@/lib/prisma';

describe('integration: deposit create then approve', () => {
  beforeEach(async () => { vi.clearAllMocks(); });

  it('creates deposit and review approval marks attendantDeposit VALID', async () => {
    // Arrange: addDeposit path should create PENDING
    (prisma as any).attendantDeposit.findFirst.mockResolvedValueOnce(null);
    (prisma as any).attendantDeposit.create.mockResolvedValueOnce({ id: 'd1', status: 'PENDING', amount: 250 });

    const created = await depositsMod.addDeposit({ outletName: 'Out1', amount: 250, note: 'REFX' });
    expect(created).toHaveProperty('status');
    // Simulate a reviewItem that targets this deposit via payload.ref
    const review = { id: 'r1', status: 'pending', type: 'deposit', outlet: 'Out1', date: new Date().toISOString(), payload: { parsed: { ref: 'REFX' } } };
    (prisma as any).reviewItem.findUnique.mockResolvedValueOnce(review);
    (prisma as any).reviewItem.update.mockResolvedValueOnce({ ...review, status: 'approved' });
    (prisma as any).attendantDeposit.updateMany.mockResolvedValueOnce({ count: 1 });

    // Act: approve via reviewItem
    const res = await reviewItem({ id: 'r1', action: 'approve' }, 'SUP1');

    // Assert
    expect(res.ok).toBe(true);
    expect((prisma as any).attendantDeposit.updateMany).toHaveBeenCalled();
  });
});

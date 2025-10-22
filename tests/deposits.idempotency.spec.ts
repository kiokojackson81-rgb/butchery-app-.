import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attendantDeposit: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';

describe('addDeposit idempotency', () => {
  beforeEach(async () => { vi.clearAllMocks(); });

  it('returns existing deposit instead of creating duplicate', async () => {
    const existing = { id: 'dexist', status: 'PENDING', amount: 200 } as any;
    (prisma as any).attendantDeposit.findFirst.mockResolvedValueOnce(existing);

    const { addDeposit } = await import('@/server/deposits');

    const res = await addDeposit({ outletName: 'Outlet Z', amount: 200, note: 'XYZ' });
    expect((prisma as any).attendantDeposit.create).not.toHaveBeenCalled();
    expect(res).toEqual(existing);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';


vi.mock('@/lib/prisma', () => {
  const supplyOpeningRow = {
    create: vi.fn(async (args: any) => ({ id: 's_created', ...(args?.data || {}) })),
    update: vi.fn(async (args: any) => ({ id: args?.where?.id || 's_updated' })),
    findUnique: vi.fn(async (_: any) => null),
  };
  const $transaction = vi.fn(async (cb: any) => cb({ supplyOpeningRow }));
  return { prisma: { supplyOpeningRow, $transaction } } as any;
});

import { prisma } from '@/lib/prisma';

describe('admin supply parity route', () => {
  beforeEach(async () => { vi.clearAllMocks(); });

  it('creates opening rows via admin API handler', async () => {
    // Arrange: build request body to POST
    const payload = { rows: [ { date: '2025-10-22', outletName: 'Outlet A', itemKey: 'beef', qty: 7, buyPrice: 100 } ] };
    const req = new Request('http://localhost/api/admin/supply', { method: 'POST', body: JSON.stringify(payload) });

    const route = (await import('@/app/api/admin/supply/route')).POST;

    // Act
    const res = await route(req as any);
  const json = await res.json();
  if (res.status !== 200) console.error('ADMIN SUPPLY ROUTE ERROR:', json);

  // Assert
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
    expect((prisma as any).supplyOpeningRow.create).toHaveBeenCalled();
  });
});

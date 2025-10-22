import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const setting = { findUnique: vi.fn(async () => ({ key: 'opening_lock:2025-10-22:Outlet A', value: { locked: true } })) };
  // supplyOpeningRow should not be called when locked
  const supplyOpeningRow = { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() };
  const $transaction = vi.fn();
  return { prisma: { setting, supplyOpeningRow, $transaction } } as any;
});

import { POST } from '@/app/api/admin/supply/route';

describe('admin supply route lock guard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects POST when opening lock exists', async () => {
    const payload = { rows: [ { date: '2025-10-22', outletName: 'Outlet A', itemKey: 'beef', qty: 7 } ] };
    const req = new Request('http://localhost/api/admin/supply', { method: 'POST', body: JSON.stringify(payload) });
    const res: any = await POST(req as any);
    const j = await res.json();
    expect(res.status).toBe(423);
    expect(j.ok).toBe(false);
    expect(j.locked).toBe(true);
  });
});

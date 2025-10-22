import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => {
  return { prisma: { setting: { findUnique: vi.fn(async () => ({ key: 'opening_lock:2025-10-22:Outlet A', value: { locked: true } })) } } } as any;
});

import { GET } from '@/app/api/admin/supply/lock/route';

describe('admin supply lock GET', () => {
  it('returns locked=true when setting exists', async () => {
    const req = new Request('http://localhost/api/admin/supply/lock?date=2025-10-22&outlet=Outlet%20A');
    const res: any = await GET(req as any);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.locked).toBe(true);
  });
});

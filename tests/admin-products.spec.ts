import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the prisma module with a factory that exposes a test control object.
vi.mock('@/lib/prisma', () => {
  const counts: any = { opening: 0, closing: 0, transfer: 0, request: 0 };
  const prisma = {
    supplyOpeningRow: { count: () => Promise.resolve(counts.opening) },
    attendantClosing: { count: () => Promise.resolve(counts.closing) },
    supplyTransfer: { count: () => Promise.resolve(counts.transfer) },
    supplyRequest: { count: () => Promise.resolve(counts.request) },
    product: {
      delete: ({ where }: any) => {
        if ((where || {}).key === 'notfound') return Promise.reject(new Error('Not found'));
        return Promise.resolve({ key: where.key });
      },
      update: ({ where, data }: any) => {
        if ((where || {}).key === 'notfound') return Promise.reject(new Error('Not found'));
        return Promise.resolve({ key: where.key, active: data.active });
      }
    }
  };
  return { prisma, __TEST_PRISMA_COUNTS: counts } as any;
});

describe('Admin product APIs', () => {
  let counts: any;

  beforeEach(async () => {
    // After vi.mock is hoisted and applied, import the mocked helper to gain access to counts
    const mod = await import('@/lib/prisma');
    counts = (mod as any).__TEST_PRISMA_COUNTS;
    counts.opening = 0; counts.closing = 0; counts.transfer = 0; counts.request = 0;
    vi.resetModules();
  });

  it('check-usage returns used=false when no references', async () => {
    const { GET } = await import('@/app/api/admin/products/check-usage/route');
    const req = new Request('http://localhost/?key=beef');
    const res = await GET(req as any);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.used).toBe(false);
    expect(j.total).toBe(0);
  });

  it('check-usage returns used=true when references exist', async () => {
    counts.opening = 2; counts.closing = 1;
    const { GET } = await import('@/app/api/admin/products/check-usage/route');
    const req = new Request('http://localhost/?key=beef');
    const res = await GET(req as any);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.used).toBe(true);
    expect(j.total).toBe(3);
    expect(Array.isArray(j.details)).toBe(true);
  });

  it('DELETE returns 409 when referenced and allows soft deactivate', async () => {
    counts.opening = 1;
    const { DELETE } = await import('@/app/api/admin/products/[key]/route');
    const req = new Request('http://localhost/admin/products/beef', { method: 'DELETE' });
    const ctx: any = { params: Promise.resolve({ key: 'beef' }) };
    const res = await DELETE(req as any, ctx);
    const j = await res.json();
    expect(res.status).toBe(409);
    expect(j.ok).toBe(false);
    expect(j.error).toBe('referenced');

    // Now soft-delete
    const req2 = new Request('http://localhost/admin/products/beef?soft=true', { method: 'DELETE' });
    const res2 = await DELETE(req2 as any, ctx);
    const j2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(j2.ok).toBe(true);
    expect(j2.deactivated).toBe(true);
  });

  it('DELETE deletes when no references', async () => {
    counts.opening = 0; counts.closing = 0; counts.transfer = 0; counts.request = 0;
    const { DELETE } = await import('@/app/api/admin/products/[key]/route');
    const req = new Request('http://localhost/admin/products/beef', { method: 'DELETE' });
    const ctx: any = { params: Promise.resolve({ key: 'beef' }) };
    const res = await DELETE(req as any, ctx);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.deleted).toBe(true);
  });
});

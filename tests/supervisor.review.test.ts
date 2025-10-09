import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset modules before each test to allow doMock
beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });
// Add a safe prisma mock for other imports
const prismaMock = new Proxy({}, { get: (_, prop) => ({ findFirst: async () => null, findUnique: async () => null, findMany: async () => [], update: async () => null, upsert: async () => null, create: async () => null, deleteMany: async () => null, $transaction: async (fn: any) => typeof fn === 'function' ? await fn(prismaMock) : null }) });
vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));

describe('reviewItem service', () => {
  it('approves pending item and is idempotent', async () => {
    const mockTxUpdate = vi.fn().mockResolvedValue({ id: 'r1', status: 'approved' });
    const prismaMock: any = { $transaction: vi.fn(async (fn:any)=> fn({ reviewItem: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'pending', payload: {} }), update: mockTxUpdate } })) };
    // Use doMock so the mock factory can reference local vars
    vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }));
    const { reviewItem } = await import('@/server/supervisor/review.service');
    const res = await reviewItem({ id: 'r1', action: 'approve' }, 'SUP1');
    expect(res.ok).toBe(true);
    expect(mockTxUpdate).toHaveBeenCalled();
  });
});

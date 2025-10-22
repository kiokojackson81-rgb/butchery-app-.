import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock session, prisma, notifications
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ attendant: { outletRef: { name: 'OutletA' } }, outletCode: 'OutletA' })) }));
vi.mock('@/server/supervisor/supervisor.notifications', () => ({ notifySupervisorsAndAdmins: vi.fn() }));
vi.mock('@/lib/wa', () => ({ sendTextSafe: vi.fn() }));
vi.mock('@/server/trading_period', () => ({ getPeriodState: vi.fn(async () => 'OPEN') }));

// We'll control prisma behavior inside the test
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn(), attendantDeposit: { findMany: vi.fn() }, phoneMapping: { findMany: vi.fn() }, attendant: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/attendant/deposit/submit/route';

describe('POST /api/attendant/deposit/submit idempotency', () => {
  beforeEach(async () => { vi.clearAllMocks(); });

  it('creates only one deposit when the same entry appears twice', async () => {
    // Arrange: two identical entries
    const body = { entries: [ { code: 'C1', amount: 500, note: 'REF1' }, { code: 'C1', amount: 500, note: 'REF1' } ] };
    const req = new Request('http://localhost/api/attendant/deposit/submit', { method: 'POST', body: JSON.stringify(body) });

    // Prepare tx attendantDeposit mock: first findFirst -> null (create), second findFirst -> existing
    const txAttendantDeposit = {
      findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'exists' }),
      create: vi.fn().mockResolvedValue({ id: 'created' }),
    };

    // Mock prisma.$transaction to call the provided fn with tx containing attendantDeposit
    (prisma as any).$transaction.mockImplementation(async (fn: any, _opts?: any) => {
      return await fn({ attendantDeposit: txAttendantDeposit } as any);
    });

    // After transaction, route reads back saved rows
    (prisma as any).attendantDeposit.findMany.mockResolvedValue([{ id: 'created', amount: 500 }]);
    // No phone mappings / attendants
    (prisma as any).phoneMapping.findMany.mockResolvedValue([]);
    (prisma as any).attendant.findMany.mockResolvedValue([]);

    // Act
    const res = await POST(req as any);
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // Ensure create called only once
    expect(txAttendantDeposit.create).toHaveBeenCalledTimes(1);
  });
});

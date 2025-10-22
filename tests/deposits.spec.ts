import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attendantDeposit: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@/server/supervisor/supervisor.notifications', () => ({
  notifyAttendants: vi.fn(),
  notifySupplier: vi.fn(),
}));

vi.mock('@/server/finance', () => ({ computeDayTotals: vi.fn() }));

// We'll import the module dynamically inside tests so env vars can be toggled before module init
import { prisma } from '@/lib/prisma';

describe('addDeposit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default envs ensure stub path off
    delete (process as any).env.FORCE_MANUAL_DEPOSITS;
    delete (process as any).env.DARAJA_VERIFY_ENABLED;
    delete (process as any).env.DARAJA_VERIFY_STUB;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a PENDING deposit when none exists', async () => {
    const deposits = await import('@/server/deposits');
    (prisma as any).attendantDeposit.findFirst.mockResolvedValue(null);
    (prisma as any).attendantDeposit.create.mockResolvedValue({ id: 'd1', status: 'PENDING', amount: 500 });

    const res = await deposits.addDeposit({ outletName: 'Outlet A', amount: 500, note: 'ABC123' });
    expect((prisma as any).attendantDeposit.create).toHaveBeenCalled();
    expect(res).toHaveProperty('status');
    expect(res.status).toBe('PENDING');
  });

  it('auto-verifies when stub enabled', async () => {
    // Ensure module cache is reset so module-level constants are re-evaluated
    vi.resetModules();
    // enable stub BEFORE importing module so constants are initialized correctly
    (process as any).env.FORCE_MANUAL_DEPOSITS = 'false';
    (process as any).env.DARAJA_VERIFY_STUB = 'true';

    const deposits = await import('@/server/deposits');

    (prisma as any).attendantDeposit.findFirst.mockResolvedValue(null);
    (prisma as any).attendantDeposit.create.mockResolvedValue({ id: 'd2', status: 'PENDING', amount: 1000 });
    (prisma as any).attendantDeposit.update.mockResolvedValue({ id: 'd2', status: 'VALID' });

    const res = await deposits.addDeposit({ outletName: 'Outlet B', amount: 1000, note: 'REFXYZ' });
    // Should attempt create and then update to VALID via stub
    expect((prisma as any).attendantDeposit.create).toHaveBeenCalled();
    // Final result contains status VALID when stubbed
    expect(res.status).toBe('VALID');
    // cleanup
    delete (process as any).env.FORCE_MANUAL_DEPOSITS;
    delete (process as any).env.DARAJA_VERIFY_STUB;
  });
});

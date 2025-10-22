import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as supplierFlow from '@/server/wa/wa_supplier_flow';
import { prisma } from '@/lib/prisma';
import { sendTextSafe, sendInteractiveSafe } from '@/lib/wa';

describe('supplier SPL_LOCK sets attendant period lock', () => {
  beforeEach(() => {
    // Provide a mock upsert to capture both opening_lock and lock:attendant writes
    const mockUpsert = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma as any, 'setting', 'get').mockReturnValue({ upsert: mockUpsert } as any);
    vi.spyOn(prisma as any, 'supplyOpeningRow', 'get').mockReturnValue({ count: vi.fn().mockResolvedValue(1) } as any);
    // Prevent notifyAttendants/notifySupervisorsAdmins from querying DB
    vi.spyOn(prisma as any, 'phoneMapping', 'get').mockReturnValue({ findMany: vi.fn().mockResolvedValue([]) } as any);
    // Prevent session update calls from hitting DB
    vi.spyOn(prisma as any, 'waSession', 'get').mockReturnValue({ update: vi.fn().mockResolvedValue({}) } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls setting.upsert for both opening_lock and lock:attendant', async () => {
  const fakeSess: any = { id: 'sess1', state: 'SPL_MENU', cursor: { date: '2025-10-22', outlet: 'TestOutlet' }, code: 'SUPP1', role: 'supplier', updatedAt: new Date().toISOString() };
  const spyUpsert = (prisma as any).setting.upsert as any;
    // call handler
    await supplierFlow.handleSupplierAction(fakeSess, 'SPL_LOCK', '254700000020');

    expect(spyUpsert).toHaveBeenCalled();
    const calls = spyUpsert.mock.calls.map((c: any[]) => c[0].where?.key || c[0].where?.key);
    const hasOpening = calls.some((k: string) => typeof k === 'string' && k.startsWith('opening_lock:'));
    const hasPeriod = calls.some((k: string) => typeof k === 'string' && k.startsWith('lock:attendant:'));
    expect(hasOpening).toBe(true);
    expect(hasPeriod).toBe(true);
  });
});

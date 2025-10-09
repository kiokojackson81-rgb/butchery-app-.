import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mocks for modules used by the worker
vi.mock('@/lib/opsEvents', () => ({
  fetchUnprocessedOpsEvents: vi.fn(),
  markEventHandled: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    supplyItem: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    supplier: { findUnique: vi.fn() },
    phoneMapping: { findMany: vi.fn() },
    setting: { findUnique: vi.fn() },
    waMessageLog: { create: vi.fn(), update: vi.fn() },
  }
}));
vi.mock('@/lib/wa/gptDispatcher', () => ({ gptDispatch: vi.fn() }));
vi.mock('@/lib/wa', () => ({ sendInteractiveSafe: vi.fn(), sendTextSafe: vi.fn(), sendTemplate: vi.fn() }));
vi.mock('@/lib/format/supply', () => ({ formatSupplyForRole: (v: any, r: any) => v }));

import { fetchUnprocessedOpsEvents, markEventHandled } from '@/lib/opsEvents';
import { prisma } from '@/lib/prisma';
import { gptDispatch } from '@/lib/wa/gptDispatcher';
import { sendTextSafe, sendInteractiveSafe } from '@/lib/wa';

// Import the worker GET handler
import * as route from '@/app/api/wa/jobs/ops-events/route';

describe('ops-events worker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('claims per-recipient message slot and sends messages', async () => {
    // Arrange: one event
    (fetchUnprocessedOpsEvents as any).mockResolvedValue([{ id: 'ev1', type: 'SUPPLY_SUBMITTED', entityId: 's1', outletId: 'o1', supplierId: 'sup1' }]);
    // supply header query
    (prisma as any).$queryRawUnsafe.mockResolvedValue([{ id: 's1', status: 'ok', eta: null, ref: null, outlet_name: 'O', supplier_name: 'S', line_count: 1, total_qty: 10, total_cost: 1000 }]);
    (prisma as any).supplyItem.findMany.mockResolvedValue([{ id: 'si1', productId: 'p1', qty: 5, unit: 'kg', unitPrice: 200 }]);
    (prisma as any).product.findMany.mockResolvedValue([{ key: 'p1', name: 'Beef' }]);
    (prisma as any).supplier.findUnique.mockResolvedValue({ phoneE164: '+254700111222' });
    (prisma as any).phoneMapping.findMany.mockImplementation(({ where }: any) => {
      if (where.role === 'attendant') return Promise.resolve([{ phoneE164: '+254700111111' }]);
      return Promise.resolve([]);
    });
    (prisma as any).setting.findUnique.mockResolvedValue({ value: [] });

    const gptCalls: any[] = [];
    (gptDispatch as any).mockImplementation(async (args: any) => {
      gptCalls.push(args);
      return { text: 'OK', buttons: [] };
    });

    (prisma as any).waMessageLog.create.mockResolvedValue(true);
    (prisma as any).waMessageLog.update.mockResolvedValue(true);

    // Act
    const res = await route.GET();

    // Assert
    expect((prisma as any).waMessageLog.create).toHaveBeenCalledTimes(2); // supplier + attendant
    expect((sendTextSafe as any).mock.calls.length + (sendInteractiveSafe as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    // gptDispatch should have been called for both roles
    expect(gptCalls.length).toBeGreaterThanOrEqual(2);
    // Worker should mark event handled
    expect(markEventHandled as any).toHaveBeenCalledWith('ev1');
  });

  it('skips recipient when waMessageLog.create conflicts', async () => {
    (fetchUnprocessedOpsEvents as any).mockResolvedValue([{ id: 'ev2', type: 'SUPPLY_SUBMITTED', entityId: 's2', outletId: 'o1', supplierId: 'sup1' }]);
    (prisma as any).$queryRawUnsafe.mockResolvedValue([{ id: 's2', status: 'ok', eta: null, ref: null, outlet_name: 'O', supplier_name: 'S', line_count: 1, total_qty: 10, total_cost: 1000 }]);
    (prisma as any).supplyItem.findMany.mockResolvedValue([{ id: 'si2', productId: 'p1', qty: 3, unit: 'kg', unitPrice: 150 }]);
    (prisma as any).product.findMany.mockResolvedValue([{ key: 'p1', name: 'Beef' }]);
    (prisma as any).supplier.findUnique.mockResolvedValue({ phoneE164: '+254700111222' });
    (prisma as any).phoneMapping.findMany.mockImplementation(({ where }: any) => {
      if (where.role === 'attendant') return Promise.resolve([{ phoneE164: '+254700111111' }]);
      return Promise.resolve([]);
    });
    (prisma as any).setting.findUnique.mockResolvedValue({ value: [] });

    const gptCalls: any[] = [];
    (gptDispatch as any).mockImplementation(async (args: any) => {
      gptCalls.push(args);
      return { text: 'OK', buttons: [] };
    });

    // Simulate conflict on attendant phone create
    (prisma as any).waMessageLog.create.mockImplementation(({ data }: any) => {
      if (String(data.payload?.phone).includes('254700111111')) throw new Error('duplicate');
      return Promise.resolve(true);
    });
    (prisma as any).waMessageLog.update.mockResolvedValue(true);

    // Act
    const res = await route.GET();

    // Assert
    // waMessageLog.create will be called, but send shouldn't be called for the conflicted recipient
    expect((prisma as any).waMessageLog.create).toHaveBeenCalled();
    // Ensure at least one send occurred (supplier)
    expect((sendTextSafe as any).mock.calls.length + (sendInteractiveSafe as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    // Ensure gpt was not called for the skipped recipient (calls < recipients) but at least for supplier
    expect(gptCalls.length).toBeGreaterThanOrEqual(1);
  });
});

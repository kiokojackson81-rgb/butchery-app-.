import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    attendantClosing: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(async () => null) },
  }
}));

vi.mock('@/lib/wa', () => ({
  sendText: vi.fn().mockResolvedValue(null),
  sendInteractive: vi.fn().mockResolvedValue(null),
  logOutbound: vi.fn(),
}));

vi.mock('@/lib/wa/state', () => ({
  getWaState: vi.fn(async () => ({})),
  updateWaState: vi.fn(async () => ({})),
}));

vi.mock('@/server/products', () => ({ getAssignedProducts: vi.fn(async () => [
  { key: 'beef', name: 'Beef' },
]) }));

vi.mock('@/server/supply', () => ({
  getTodaySupplySummary: vi.fn(async () => [
    { key: 'beef', name: 'Beef', qty: 10, unit: 'kg' },
  ]),
}));

import { handleInteractiveReply } from '@/lib/wa_attendant_flow';

function payloadButton(id: string) {
  return { list_reply: undefined, button_reply: { id, title: id } } as any;
}

describe('supply -> next actions', () => {
  beforeEach(async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({
      id: 'sess', phoneE164: '+254712345678', state: 'MENU', role: 'attendant', code: 'A1', outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [] }, updatedAt: new Date().toISOString(),
    });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });
    (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([{ itemKey: 'beef', qty: 10, unit: 'kg' }]);
    (prisma as any).product.findMany.mockResolvedValueOnce([{ key: 'beef', unit: 'kg' }]);
    (prisma as any).attendantClosing.findMany.mockResolvedValue([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('after supply, shows next actions buttons', async () => {
    const waMod: any = await import('@/lib/wa');
    await handleInteractiveReply('+254712345678', payloadButton('MENU_SUPPLY'));
    const btnCall = (waMod.sendInteractive as any).mock.calls.find((c: any) => c?.[1] === 'AI_DISPATCH_INTERACTIVE');
    const payload = btnCall?.[0];
    // Should include Enter Closing button id somewhere
    const rows = payload?.interactive?.action?.buttons || payload?.action?.buttons;
    const ids = (rows || []).map((b: any) => b?.reply?.id);
    expect(ids).toContain('ATT_CLOSING');
  });
});

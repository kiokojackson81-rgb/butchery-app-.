import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks: define inline objects inside factory to avoid referencing top-level vars
vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    attendantClosing: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  }
}));

vi.mock('@/lib/wa', () => ({
  sendText: vi.fn().mockResolvedValue(null),
  sendInteractive: vi.fn().mockResolvedValue(null),
  logOutbound: vi.fn(),
}));

vi.mock('@/server/supply', () => ({
  getTodaySupplySummary: vi.fn(),
}));

// Import after mocks
import { handleInteractiveReply } from '@/lib/wa_attendant_flow';

function payloadButton(id: string) {
  return {
    list_reply: undefined,
    button_reply: { id, title: id },
  } as any;
}

describe('attendant supply parity', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default session for +254700000111
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({
      id: 'sess1',
      phoneE164: '+254700000111',
      state: 'MENU',
      role: 'attendant',
      code: 'A123',
      outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [] },
      updatedAt: new Date().toISOString(),
    });
    ;(prisma as any).waSession.update.mockImplementation(async (_: any) => ({ id: 'sess1' }));
    ;(prisma as any).waSession.create.mockImplementation(async (args: any) => ({ id: 'sess1', ...args?.data }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MENU_SUPPLY shows dashboard stock summary lines', async () => {
    // Arrange dashboard-like summary
  const { getTodaySupplySummary } = await import('@/server/supply');
  const waMod: any = await import('@/lib/wa');
  (getTodaySupplySummary as any).mockResolvedValue([
      { key: 'beef', name: 'Beef', qty: 120, unit: 'kg' },
      { key: 'goat', name: 'Goat', qty: 45, unit: 'kg' },
    ]);

    // Act
    await handleInteractiveReply('+254700000111', payloadButton('MENU_SUPPLY'));

    // Assert
  expect((getTodaySupplySummary as any)).toHaveBeenCalledWith('TestOutlet', '2025-10-12');
  const call = (waMod.sendText as any).mock.calls.find((c: any) => String(c?.[1] || '').includes('Opening stock for TestOutlet'));
    expect(call?.[1]).toContain('- Beef: 120 kg');
    expect(call?.[1]).toContain('- Goat: 45 kg');
  });

  it('MENU_SUPPLY falls back to yesterday closing when summary empty', async () => {
  const { getTodaySupplySummary: getSummary2 } = await import('@/server/supply');
  const waMod: any = await import('@/lib/wa');
  (getSummary2 as any).mockResolvedValue([]);
    // Yesterday closing fallback queries product names; keep them simple
  const { prisma } = await import('@/lib/prisma');
  (prisma as any).attendantClosing.findMany.mockResolvedValueOnce([
      { itemKey: 'beef', closingQty: 100 },
      { itemKey: 'goat', closingQty: 40 },
    ]);
  ;(prisma as any).product.findMany.mockResolvedValueOnce([
      { key: 'beef', name: 'Beef' },
      { key: 'goat', name: 'Goat' },
    ]);

    await handleInteractiveReply('+254700000111', payloadButton('MENU_SUPPLY'));

  const call = (waMod.sendText as any).mock.calls.find((c: any) => String(c?.[1] || '').includes('Opening baseline (yesterday closing)'));
    expect(call?.[1]).toContain('- Beef: 100');
    expect(call?.[1]).toContain('- Goat: 40');
  });
});

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
    supplyOpeningRow: { findMany: vi.fn() },
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

// Assigned products helper
vi.mock('@/server/products', () => ({ getAssignedProducts: vi.fn(async () => [
  { key: 'beef', name: 'Beef' },
  { key: 'goat', name: 'Goat' },
  { key: 'matumbo', name: 'Matumbo' },
]) }));

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
  ;(prisma as any).supplyOpeningRow.findMany.mockResolvedValue([]);
  ;(prisma as any).attendantClosing.findMany.mockResolvedValue([]);
  ;(prisma as any).product.findMany.mockResolvedValue([]);
    // Run handler in non-DRY mode so menu and supply messages are emitted
    (process as any).env.NODE_ENV = 'production';
    process.env.WA_DRY_RUN = 'false';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MENU_SUPPLY shows all assigned with today quantities and zero for missing', async () => {
    // Arrange: opening exists only for beef; others zero
    const { getTodaySupplySummary } = await import('@/server/supply');
    const waMod: any = await import('@/lib/wa');
    (getTodaySupplySummary as any).mockResolvedValue([
      { key: 'beef', name: 'Beef', qty: 10, unit: 'kg' },
    ]);
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([{ itemKey: 'beef', qty: 10, unit: 'kg' }]);
    (prisma as any).product.findMany.mockResolvedValueOnce([
      { key: 'beef', unit: 'kg' },
      { key: 'goat', unit: 'kg' },
      { key: 'matumbo', unit: 'kg' },
    ]);

    // Act
    await handleInteractiveReply('+254700000111', payloadButton('MENU_SUPPLY'));

    // Assert
  const calls = (waMod.sendText as any).mock.calls as any[];
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Beef'))).toBe(true);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Goat'))).toBe(true);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Matumbo'))).toBe(true);
  });

  it('MENU_SUPPLY handles empty opening by listing all assigned with zeroes', async () => {
    const { getTodaySupplySummary } = await import('@/server/supply');
    const waMod: any = await import('@/lib/wa');
    (getTodaySupplySummary as any).mockResolvedValue([]);
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([]);
    (prisma as any).product.findMany.mockResolvedValueOnce([
      { key: 'beef', unit: 'kg' },
      { key: 'goat', unit: 'kg' },
      { key: 'matumbo', unit: 'kg' },
    ]);

    await handleInteractiveReply('+254700000111', payloadButton('MENU_SUPPLY'));

  const calls = (waMod.sendText as any).mock.calls as any[];
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Beef'))).toBe(true);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Goat'))).toBe(true);
  expect(calls.some((c) => String(c?.[1] || '').includes('- Matumbo'))).toBe(true);
  });
});

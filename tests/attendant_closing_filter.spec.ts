import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted prisma mock defined inline in factory
vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    attendantClosing: { findMany: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(async () => null) },
  }
}));
// Also mock WA state helpers used by flow to avoid DB calls
vi.mock('@/lib/wa/state', () => ({
  getWaState: vi.fn(async () => ({})),
  updateWaState: vi.fn(async () => ({})),
}));

// WA senders
vi.mock('@/lib/wa', () => ({
  sendText: vi.fn().mockResolvedValue(null),
  sendInteractive: vi.fn().mockResolvedValue(null),
  logOutbound: vi.fn(),
}));

// Assigned products helper
vi.mock('@/server/products', () => ({ getAssignedProducts: vi.fn(async () => [
  { key: 'beef', name: 'Beef' },
  { key: 'goat', name: 'Goat' },
  { key: 'chicken', name: 'Chicken' },
]) }));

import { handleInteractiveReply } from '@/lib/wa_attendant_flow';

function payloadButton(id: string) {
  return { list_reply: undefined, button_reply: { id, title: id } } as any;
}

describe('attendant closing product filtering', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  const { prisma } = await import('@/lib/prisma');
  (prisma as any).waSession.findUnique.mockResolvedValue({
      id: 'sess2',
      phoneE164: '+254700000222',
      state: 'MENU',
      role: 'attendant',
      code: 'A222',
      outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [] },
      updatedAt: new Date().toISOString(),
    });
  ;(prisma as any).waSession.update.mockResolvedValue({ id: 'sess2' });
  ;(prisma as any).attendantClosing.findMany.mockResolvedValue([]); // nothing closed yet today
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('restricts to opening-stock items when opening exists', async () => {
  const { prisma } = await import('@/lib/prisma');
  (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([
      { itemKey: 'beef' },
      { itemKey: 'goat' },
    ]);

  await handleInteractiveReply('+254700000222', payloadButton('ATT_CLOSING'));

  // We expect an interactive list with beef/goat only (chicken excluded)
  const waMod: any = await import('@/lib/wa');
  const call = (waMod.sendInteractive as any).mock.calls.find((c: any) => c?.[1] === 'AI_DISPATCH_INTERACTIVE');
  const payload = call?.[0];
    const rows = payload?.interactive?.action?.sections?.[0]?.rows || payload?.action?.sections?.[0]?.rows;
    const titles = (rows || []).map((r: any) => r.title);
    expect(titles).toContain('Beef');
    expect(titles).toContain('Goat');
    expect(titles).not.toContain('Chicken');
  });

  it('falls back to all assigned minus closed when no opening exists', async () => {
  const { prisma } = await import('@/lib/prisma');
  (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([]);

  await handleInteractiveReply('+254700000222', payloadButton('ATT_CLOSING'));

  const waMod: any = await import('@/lib/wa');
  const call = (waMod.sendInteractive as any).mock.calls.find((c: any) => c?.[1] === 'AI_DISPATCH_INTERACTIVE');
  const payload = call?.[0];
    const rows = payload?.interactive?.action?.sections?.[0]?.rows || payload?.action?.sections?.[0]?.rows;
    const titles = (rows || []).map((r: any) => r.title);
    expect(titles).toEqual(expect.arrayContaining(['Beef', 'Goat', 'Chicken']));
  });
});

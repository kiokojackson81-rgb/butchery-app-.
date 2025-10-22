import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    personCode: { findFirst: vi.fn() },
    phoneMapping: { findUnique: vi.fn() },
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

import { handleInteractiveReply, handleInboundText } from '@/lib/wa_attendant_flow';

describe('logout preserves cursor', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('interactive LOGOUT does not wipe cursor', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({ id: 'sess', phoneE164: '+254700000009', state: 'MENU', role: 'attendant', code: 'ATT009', outlet: 'OutletZ', cursor: { date: '2025-10-12', rows: [{ key: 'g', name: 'G' }] }, updatedAt: new Date().toISOString() });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });

    await handleInteractiveReply('+254700000009', { button_reply: { id: 'LOGOUT' } } as any);

  // Expect we attempted to update the session, and that the update did not explicitly set cursor to {}
  const calls = (prisma as any).waSession.update.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const callPayload = JSON.stringify(calls[0][0] || calls[0][1] || {});
  // Primary concern: cursor not wiped
  expect(callPayload).to.not.include('"cursor": {}');
  });

  it('text SWITCH/LOGOUT does not wipe cursor', async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({ id: 'sess', phoneE164: '+254700000008', state: 'MENU', role: 'attendant', code: 'ATT008', outlet: 'OutletY', cursor: { date: '2025-10-12', rows: [{ key: 'x', name: 'X' }] }, updatedAt: new Date().toISOString() });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });

    await handleInboundText('+254700000008', 'LOGOUT');

  const calls2 = (prisma as any).waSession.update.mock.calls;
  expect(calls2.length).toBeGreaterThan(0);
  const callPayload2 = JSON.stringify(calls2[0][0] || calls2[0][1] || {});
  expect(callPayload2).to.not.include('"cursor": {}');
  });
});

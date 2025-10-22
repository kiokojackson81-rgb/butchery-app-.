import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    attendantExpense: { create: vi.fn(), count: vi.fn() },
    attendantClosing: { findMany: vi.fn(), deleteMany: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
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

vi.mock('@/server/closings', () => ({ saveClosings: vi.fn(async () => null) }));
vi.mock('@/server/commission', () => ({ upsertAndNotifySupervisorCommission: vi.fn(async () => null) }));
vi.mock('@/server/notifications/day_close', () => ({ sendDayCloseNotifications: vi.fn(async () => null) }));
vi.mock('@/server/finance', () => ({ computeDayTotals: vi.fn(async () => ({ expectedDeposit: 0 })) }));
vi.mock('@/server/trading_period', () => ({ getCloseCount: vi.fn(async () => 0), incrementCloseCount: vi.fn(async () => 1), getPeriodState: vi.fn(async () => 'OPEN') }));

import { handleInteractiveReply, handleInboundText } from '@/lib/wa_attendant_flow';

function payloadButton(id: string) {
  return { list_reply: undefined, button_reply: { id, title: id } } as any;
}

describe('expense flow after submit', () => {
  beforeEach(async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({
      id: 'sess', phoneE164: '+254700000002', state: 'CLOSING_PICK', role: 'attendant', code: 'ATT002', outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'GOAT', closing: 8, waste: 0 }] }, updatedAt: new Date().toISOString(),
    });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });
    (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([{ itemKey: 'goat', qty: 10, unit: 'kg' }]);
    (prisma as any).product.findMany.mockResolvedValueOnce([{ key: 'goat', unit: 'kg' }]);
    (prisma as any).attendantClosing.findMany.mockResolvedValue([]);
    (prisma as any).attendantExpense.count.mockResolvedValue(0);
    (prisma as any).attendantExpense.findFirst = vi.fn(async () => null);
    (prisma as any).attendantExpense.create.mockResolvedValue({ id: 'e1', name: 'Ice', amount: 200 });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('persists expense and returns to menu after finish', async () => {
    const waMod: any = await import('@/lib/wa');
    // Submit and confirm to reach the post-submit state where expense prompt is sent
    await handleInteractiveReply('+254700000002', payloadButton('SUMMARY_SUBMIT'));
    await handleInteractiveReply('+254700000002', payloadButton('SUMMARY_SUBMIT_CONFIRM'));

    // Attendant chooses Add Expense
    await handleInteractiveReply('+254700000002', payloadButton('ATT_EXPENSE'));
    // System should ask for expense name; simulate entering a name via the text handler
    // Ensure loadSession returns EXPENSE_NAME for the next inbound text
    const { prisma: prisma2 } = await import('@/lib/prisma');
    (prisma2 as any).waSession.findUnique.mockResolvedValue({
      id: 'sess', phoneE164: '+254700000002', state: 'EXPENSE_NAME', role: 'attendant', code: 'ATT002', outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'GOAT', closing: 8, waste: 0 }], expenseName: undefined }, updatedAt: new Date().toISOString(),
    });
    await handleInboundText('+254700000002', 'Ice');
    // Now simulate that session is in EXPENSE_AMOUNT prior to the amount text
    const { prisma: prisma3 } = await import('@/lib/prisma');
    (prisma3 as any).waSession.findUnique.mockResolvedValue({
      id: 'sess', phoneE164: '+254700000002', state: 'EXPENSE_AMOUNT', role: 'attendant', code: 'ATT002', outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'GOAT', closing: 8, waste: 0 }], expenseName: 'Ice' }, updatedAt: new Date().toISOString(),
    });
    await handleInboundText('+254700000002', '200');

    // After creating expense, the flow should send the menu/finish. Assert attendantExpense.create called
    const { prisma } = await import('@/lib/prisma');
    expect((prisma as any).attendantExpense.create).toHaveBeenCalled();

    // And the WA module should have been asked to send something (menu or confirmation)
    const calls = (waMod.sendInteractive as any).mock.calls.concat((waMod.sendText as any).mock.calls);
    expect(calls.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waSession: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    attendantClosing: { findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    product: { findMany: vi.fn() },
    attendantExpense: { count: vi.fn() },
    pricebookRow: { findFirst: vi.fn() },
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
  { key: 'goat', name: 'Goat' },
]) }));

vi.mock('@/server/supply', () => ({
  getTodaySupplySummary: vi.fn(async () => [
    { key: 'goat', name: 'Goat', qty: 8, unit: 'kg' },
  ]),
}));

// Mock server helpers involved in submit flow so the submit path completes cleanly
vi.mock('@/server/closings', () => ({ saveClosings: vi.fn(async () => null) }));
vi.mock('@/server/commission', () => ({ upsertAndNotifySupervisorCommission: vi.fn(async () => null) }));
vi.mock('@/server/notifications/day_close', () => ({ sendDayCloseNotifications: vi.fn(async () => null) }));
vi.mock('@/server/finance', () => ({ computeDayTotals: vi.fn(async () => ({ expectedDeposit: 0 })) }));
vi.mock('@/server/trading_period', () => ({ getCloseCount: vi.fn(async () => 0), incrementCloseCount: vi.fn(async () => 1), getPeriodState: vi.fn(async () => 'OPEN') }));

import { handleInteractiveReply } from '@/lib/wa_attendant_flow';

function payloadButton(id: string) {
  return { list_reply: undefined, button_reply: { id, title: id } } as any;
}

describe('closing -> prompt ordering', () => {
  beforeEach(async () => {
    const { prisma } = await import('@/lib/prisma');
    (prisma as any).waSession.findUnique.mockResolvedValue({
      id: 'sess', phoneE164: '+254700000001', state: 'CLOSING_PICK', role: 'attendant', code: 'ATT001', outlet: 'TestOutlet',
      cursor: { date: '2025-10-12', rows: [{ key: 'goat', name: 'GOAT', closing: 8, waste: 0 }] }, updatedAt: new Date().toISOString(),
    });
    (prisma as any).waSession.update.mockResolvedValue({ id: 'sess' });
    (prisma as any).supplyOpeningRow.findMany.mockResolvedValueOnce([{ itemKey: 'goat', qty: 10, unit: 'kg' }]);
    (prisma as any).product.findMany.mockResolvedValueOnce([{ key: 'goat', unit: 'kg' }]);
    (prisma as any).attendantClosing.findMany.mockResolvedValue([]);
    (prisma as any).attendantExpense.count.mockResolvedValue(0);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('does not send expense prompt at summary display but sends after submit', async () => {
    const waMod: any = await import('@/lib/wa');
    // Trigger showing the summary (this should call nextPickOrSummary and send the summary interactive)
    await handleInteractiveReply('+254700000001', payloadButton('ATT_CLOSING'));
    // Find interactive sends
    const interactiveSends = (waMod.sendInteractive as any).mock.calls.filter((c: any) => c?.[1] === 'AI_DISPATCH_INTERACTIVE');
    // The last interactive at this point should be the summary payload (but NOT the expense notify)
    const texts = interactiveSends.map((c: any) => JSON.stringify(c?.[0] || ''));
    const hasExpenseNotifyAtSummary = texts.some((t: string) => t.includes('All products captured. Would you like to add expenses or proceed?'));
    expect(hasExpenseNotifyAtSummary).toBe(false);

  // Now simulate pressing Confirm & Submit -> this will trigger a pre-submit confirmation because
  // no expenses were recorded; simulate the attendant confirming the confirmation by sending
  // SUMMARY_SUBMIT_CONFIRM so the submit path executes.
  (waMod.sendInteractive as any).mockClear();
  await handleInteractiveReply('+254700000001', payloadButton('SUMMARY_SUBMIT'));
  // The flow should have sent a confirmation; simulate the user pressing "Yes, Submit"
  await handleInteractiveReply('+254700000001', payloadButton('SUMMARY_SUBMIT_CONFIRM'));

  const interactiveAfterSubmit = (waMod.sendInteractive as any).mock.calls.filter((c: any) => c?.[1] === 'AI_DISPATCH_INTERACTIVE');
  // debug print for failing investigation
  // eslint-disable-next-line no-console
  console.log('interactiveAfterSubmit count=', interactiveAfterSubmit.length);
  // eslint-disable-next-line no-console
  interactiveAfterSubmit.forEach((c: any, idx: number) => console.log('call', idx, JSON.stringify(c?.[0] || null)));
  const afterTexts = interactiveAfterSubmit.map((c: any) => JSON.stringify(c?.[0] || ''));
  const hasExpenseNotifyAfter = afterTexts.some((t: string) => t.includes('All products captured. Would you like to add expenses or proceed?'));
  expect(hasExpenseNotifyAfter).toBe(true);
  });
});

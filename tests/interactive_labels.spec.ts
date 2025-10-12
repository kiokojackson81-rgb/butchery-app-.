import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ensure GPT-only guard is off for this unit test
process.env.WA_GPT_ONLY = "false";

vi.mock('@/lib/wa', () => ({ sendInteractive: vi.fn(), sendText: vi.fn() }));
vi.mock('@/lib/wa_config', () => ({ getAttendantConfig: async () => ({ enableWaste: true, enableExpense: true, enableDeposit: true, enableTxns: true, enableSupplyView: true, enableSummary: true, enableSubmitAndLock: false }) }));
// Mock trading period to avoid DB access during tests
vi.mock('@/server/trading_period', () => ({ getPeriodState: async (_outlet: string, _date: string) => 'OPEN' }));

import { sendInteractive } from '@/lib/wa';
import { safeSendGreetingOrMenu } from '@/lib/wa_attendant_flow';

describe('interactive menu labels', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends attendant menu with dashboard labels', async () => {
  await safeSendGreetingOrMenu({ phone: '+254700000000', role: 'attendant', outlet: 'TestOutlet', force: true, source: 'test' });
    expect(sendInteractive).toHaveBeenCalled();
    const payload = (sendInteractive as any).mock.calls[0][0];
    const rows = payload.interactive.action.sections[0].rows.map((r: any) => r.title);
    expect(rows).toContain('Enter Closing');
    expect(rows).toContain('Deposit');
    expect(rows).toContain('Expense');
    expect(rows).toContain('Summary');
    expect(rows).toContain('Till Count');
    expect(rows).toContain('Supply');
  });
});

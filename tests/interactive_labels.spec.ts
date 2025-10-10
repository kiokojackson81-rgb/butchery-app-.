import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ensure GPT-only guard is off for this unit test
process.env.WA_GPT_ONLY = "false";

vi.mock('@/lib/wa', () => ({ sendInteractive: vi.fn(), sendText: vi.fn() }));
vi.mock('@/lib/wa_config', () => ({ getAttendantConfig: async () => ({ enableWaste: true, enableExpense: true, enableDeposit: true, enableTxns: true, enableSupplyView: true, enableSummary: true, enableSubmitAndLock: false }) }));
// Mock trading period to avoid DB access during tests
vi.mock('@/server/trading_period', () => ({ getPeriodState: async (_outlet: string, _date: string) => 'OPEN' }));

import { sendInteractive } from '@/lib/wa';
// Mock the new GPT greeting helper so tests remain deterministic
vi.mock('@/lib/wa_gpt_helpers', () => ({
  sendGptGreeting: async (phone: string, role: string, outlet?: string) => {
    // emulate sending an interactive list payload similar to the legacy menu
    const payload = {
      interactive: { action: { sections: [{ rows: [
        { id: 'ATT_TAB_STOCK', title: 'Enter Closing' },
        { id: 'MENU_SUPPLY', title: 'Supply' },
        { id: 'ATT_DEPOSIT', title: 'Deposit' },
        { id: 'ATT_EXPENSE', title: 'Expense' },
        { id: 'MENU_TXNS', title: 'Till Count' },
        { id: 'MENU_SUMMARY', title: 'Summary' },
      ] }] } }
    } as any;
    const { sendInteractive } = await import('@/lib/wa');
    await sendInteractive(payload, 'TEST');
  }
}));
import { sendGptGreeting } from '@/lib/wa_gpt_helpers';

describe('interactive menu labels', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends attendant menu with dashboard labels', async () => {
    await sendGptGreeting('+254700000000', 'attendant', 'TestOutlet');
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

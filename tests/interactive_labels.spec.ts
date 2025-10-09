import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/wa', () => ({ sendInteractive: vi.fn(), sendText: vi.fn() }));
vi.mock('@/lib/wa_config', () => ({ getAttendantConfig: async () => ({ enableWaste: true, enableExpense: true, enableDeposit: true, enableTxns: true, enableSupplyView: true, enableSummary: true, enableSubmitAndLock: false }) }));

import { sendAttendantMenu } from '@/lib/wa_menus';
import { sendInteractive } from '@/lib/wa';

describe('interactive menu labels', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends attendant menu with dashboard labels', async () => {
    await sendAttendantMenu('+254700000000', 'TestOutlet');
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

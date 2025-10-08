import { describe, it, expect } from 'vitest';
import { planDryResponse } from '@/lib/gpt_dry';

describe('gpt_dry planner', () => {
  it('maps digit 1 to ATT_TAB_STOCK', () => {
    const r = planDryResponse('1');
    expect(r.ooc.intent).toBe('ATT_TAB_STOCK');
    expect(r.ooc.buttons?.length).toBe(6);
  });

  it('parses expense quick add', () => {
    const r = planDryResponse('Expense Fuel 300');
    expect(r.ooc.intent).toBe('ATT_EXPENSE_ADD');
    expect(r.ooc.args?.category).toBe('Fuel');
    expect(r.ooc.args?.amount).toBe(300);
  });

  it('detects MPESA deposit', () => {
    const r = planDryResponse('Confirmed. Ksh 12,000 received from XYZ ABC. Ref QAB12CD34E5.');
    expect(r.ooc.intent).toBe('ATT_DEPOSIT');
    expect(r.ooc.args?.amount).toBe(12000);
    expect(r.ooc.args?.code).toMatch(/[A-Z0-9]{10,}/);
  });
});

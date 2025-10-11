import { describe, it, expect } from 'vitest';
import { planDryResponse } from '@/lib/gpt_dry';

describe('gpt_dry planner', () => {
  it('maps digit 1 to ATT_CLOSING', () => {
    const r = planDryResponse('1');
    expect(r.ooc.intent).toBe('ATT_CLOSING');
    expect(r.ooc.buttons).toEqual(['ATT_CLOSING', 'ATT_DEPOSIT', 'ATT_EXPENSE', 'MENU_SUMMARY']);
    expect(r.ooc.next_state_hint).toBe('CLOSING_PICK');
  });

  it('parses expense quick add', () => {
    const r = planDryResponse('Expense Fuel 300');
    expect(r.ooc.intent).toBe('ATT_EXPENSE');
    expect(r.ooc.args?.item).toBe('Fuel');
    expect(r.ooc.args?.amountKES).toBe(300);
    expect(r.ooc.next_state_hint).toBe('EXPENSE_CONFIRM');
  });

  it('detects MPESA deposit', () => {
    const r = planDryResponse('Confirmed. Ksh 12,000 received from XYZ ABC. Ref QAB12CD34E5.');
    expect(r.ooc.intent).toBe('ATT_DEPOSIT');
    expect(r.ooc.args?.amountKES).toBe(12000);
    expect(r.ooc.args?.mpesaRef).toMatch(/[A-Z0-9]{10,}/);
    expect(r.ooc.next_state_hint).toBe('WAIT_DEPOSIT');
  });
});

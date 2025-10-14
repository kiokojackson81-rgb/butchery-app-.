import { describe, expect, it } from 'vitest';
import { buildAttendantCommissionMessage } from '@/lib/analytics/day-close.service';

describe('attendant commission WhatsApp message', () => {
  it('above target → congratulatory with amount', () => {
    const msg = buildAttendantCommissionMessage({ totalWeight: 31.4, target: 25, rate: 50, amount: (31.4-25)*50, name: 'Musyoki' });
    expect(msg).toMatch(/You sold 31\.4 kg/);
    expect(msg).toMatch(/target 25 kg/);
    expect(msg).toMatch(/commission of Ksh/);
    expect(msg).toMatch(/Great job, Musyoki!/);
  });

  it('below target → shortfall note and rate hint', () => {
    const msg = buildAttendantCommissionMessage({ totalWeight: 20, target: 25, rate: 50, amount: 0, name: 'Wanjiru' });
    expect(msg).toMatch(/You were short by 5\.0 kg/);
    expect(msg).toMatch(/Ksh 50\/kg/);
    expect(msg).toMatch(/Keep pushing, Wanjiru!/);
  });

  it('no target configured → simple sales line', () => {
    const msg = buildAttendantCommissionMessage({ totalWeight: 12.2, target: 0, rate: 0, amount: 0 });
    expect(msg).toMatch(/You sold 12\.2 kg today\./);
  });
});

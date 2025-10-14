import { describe, expect, it } from 'vitest';

// Minimal pure helpers to validate commission math decisions
function commissionKg(totalWeight: number, targetKg: number): number {
  return Math.max(0, (totalWeight || 0) - (targetKg || 0));
}
function commissionAmount(totalWeight: number, targetKg: number, ratePerKg: number): number {
  return Math.round(commissionKg(totalWeight, targetKg) * (ratePerKg || 0));
}

// required deposit adjustment = expectedDeposit - commissionAmount
function adjustedExpectedDeposit(expectedDeposit: number, amount: number): number {
  const v = (expectedDeposit || 0) - (amount || 0);
  return Math.max(0, v);
}

describe('commission math', () => {
  it('below target → 0 kg, 0 amount', () => {
    expect(commissionKg(20, 25)).toBe(0);
    expect(commissionAmount(20, 25, 50)).toBe(0);
  });

  it('at target → 0 kg, 0 amount', () => {
    expect(commissionKg(25, 25)).toBe(0);
    expect(commissionAmount(25, 25, 50)).toBe(0);
  });

  it('above target → positive kg and amount', () => {
    expect(commissionKg(31.4, 25)).toBeCloseTo(6.4, 5);
    expect(commissionAmount(31.4, 25, 50)).toBe(Math.round(6.4 * 50));
  });

  it('adjusts expected deposit down by commission (floored at 0)', () => {
    expect(adjustedExpectedDeposit(2000, 0)).toBe(2000);
    expect(adjustedExpectedDeposit(2000, 300)).toBe(1700);
    expect(adjustedExpectedDeposit(200, 500)).toBe(0);
  });
});

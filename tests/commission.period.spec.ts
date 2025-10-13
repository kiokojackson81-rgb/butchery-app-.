import { describe, it, expect } from 'vitest';
import { getCommissionPeriodFor } from '@/server/commission';

describe('commission period (24th→23rd)', () => {
  it('13 Oct 2025 falls in 24 Sep → 23 Oct', () => {
    const p = getCommissionPeriodFor('2025-10-13');
    expect(p.start).toBe('2025-09-24');
    expect(p.end).toBe('2025-10-23');
    expect(p.key).toBe('2025-09-24_to_2025-10-23');
  });

  it('24 Oct 2025 starts new period 24 Oct → 23 Nov', () => {
    const p = getCommissionPeriodFor('2025-10-24');
    expect(p.start).toBe('2025-10-24');
    expect(p.end).toBe('2025-11-23');
    expect(p.key).toBe('2025-10-24_to_2025-11-23');
  });

  it('1 Feb 2025 belongs to Jan 24 → Feb 23', () => {
    const p = getCommissionPeriodFor('2025-02-01');
    expect(p.start).toBe('2025-01-24');
    expect(p.end).toBe('2025-02-23');
    expect(p.key).toBe('2025-01-24_to_2025-02-23');
  });
});

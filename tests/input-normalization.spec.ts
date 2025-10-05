import { describe, it, expect } from 'vitest';

// Pull in the pure function by duplicating its logic here for now
// to avoid JSDOM/browser deps. We keep it identical to the bridge.
function normalizeLeadingZeros(value: string): string {
  if (value == null as any) return value as any;
  let v = String(value);
  if (v === "") return v;
  let sign = "";
  if (v.startsWith("-")) { sign = "-"; v = v.slice(1); }
  const hasDot = v.includes(".");
  if (hasDot) {
    const [int, frac] = v.split(".");
    const intNorm = /^0+$/.test(int) ? "0" : int.replace(/^0+/, "");
    const safeInt = intNorm === "" ? "0" : intNorm;
    return `${sign}${safeInt}.${frac}`;
  }
  if (/^0+$/.test(v)) return "0";
  v = v.replace(/^0+/, "");
  return `${sign}${v}`;
}

describe('normalizeLeadingZeros', () => {
  it('keeps single 0', () => {
    expect(normalizeLeadingZeros('0')).toBe('0');
  });
  it('strips leading zeros for integers', () => {
    expect(normalizeLeadingZeros('0012')).toBe('12');
    expect(normalizeLeadingZeros('000')).toBe('0');
  });
  it('preserves sign', () => {
    expect(normalizeLeadingZeros('-0003')).toBe('-3');
  });
  it('handles decimals', () => {
    expect(normalizeLeadingZeros('000.50')).toBe('0.50');
    expect(normalizeLeadingZeros('012.34')).toBe('12.34');
    expect(normalizeLeadingZeros('-000.25')).toBe('-0.25');
  });
  it('empty stays empty', () => {
    expect(normalizeLeadingZeros('')).toBe('');
  });
});

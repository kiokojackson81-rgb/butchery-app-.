import { describe, it, expect } from 'vitest';
import { formatDailyReportSupplier, formatDailyReportOps } from '@/lib/wa_supply_daily_report';

const date = new Date('2025-10-15T16:00:00Z');

describe('Daily report formatters', () => {
  const items = [
    { productKey: 'beef', name: 'Beef', qty: 10, unit: 'kg', buyPrice: 450, sellPrice: 550 },
    { productKey: 'goat', name: 'Goat', qty: 5, unit: 'kg', buyPrice: 400, sellPrice: 500 },
  ];
  it('supplier: omits selling/margin/expected, shows total purchase only', () => {
    const text = formatDailyReportSupplier({ outletName: 'Outlet A', date, attendantName: 'Alice', supplierName: 'Kyalo', items });
    expect(text).toContain('Daily Supply Report — Outlet A');
    expect(text).toContain('Received by: Alice');
    expect(text).toContain('Supplied by: Kyalo');
    expect(text).toContain('• Beef: 10kg');
    expect(text).toContain('• Goat: 5kg');
    // No selling/margin/expected
    expect(text).not.toContain('Selling price');
    expect(text).not.toContain('Margin');
    expect(text).not.toContain('Expected value');
    // Total purchase amount: (10*450) + (5*400) = 6500
    expect(text).toContain('Total purchase amount: Ksh');
  });

  it('ops: includes selling/margin/expected and totals', () => {
    const text = formatDailyReportOps({ outletName: 'Outlet A', date, attendantName: 'Alice', supplierName: 'Kyalo', items });
    expect(text).toContain('• Beef: 10kg');
    expect(text).toContain('Buying price');
    expect(text).toContain('Selling price');
    expect(text).toContain('Margin');
    expect(text).toContain('Expected value');
    expect(text).toContain('Total buying price');
    expect(text).toContain('Total expected revenue');
  });
});

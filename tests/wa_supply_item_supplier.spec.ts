import { describe, it, expect } from 'vitest';
import { formatPerItemSupplyMessage } from '@/lib/wa_supply_item_format';

describe('formatPerItemSupplyMessage (supplier name)', () => {
  it('renders supplier name when provided', () => {
    const txt = formatPerItemSupplyMessage({
      outletName: 'Downtown',
      date: new Date('2025-10-15T08:30:00Z'),
      productName: 'goat',
      unit: 'kg',
      supplyQty: 10,
      openingQty: 0,
      sellPricePerUnit: 500,
      attendantName: 'Alice',
      supplierName: 'Mutua Supplies',
    });
    expect(txt).toContain('👨‍🍳 Received by: Alice');
    expect(txt).toContain('🚚 Delivered by: Mutua Supplies');
  });
});

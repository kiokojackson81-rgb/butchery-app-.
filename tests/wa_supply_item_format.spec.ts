import { describe, it, expect } from 'vitest';
import { formatPerItemSupplyMessage } from '@/lib/wa_supply_item_format';

describe('formatPerItemSupplyMessage', () => {
  it('renders without price/value when price is missing', () => {
    const txt = formatPerItemSupplyMessage({
      outletName: 'Downtown',
      date: new Date('2025-10-15T08:30:00Z'),
      productName: 'goat',
      unit: 'kg',
      supplyQty: 22,
      openingQty: 5,
    });
    expect(txt).toContain('🧾 Supply Received — Downtown');
    expect(txt).toContain('🛒 Product: goat');
    expect(txt).toContain('📦 Supplied: 22');
    expect(txt).toContain('🔁 Opening stock: 5');
    expect(txt).toContain('📊 Total stock (Opening + Supply): 27');
    expect(txt).not.toContain('💰 Price per');
    expect(txt).not.toContain('🧮 Expected total value');
    expect(txt).toContain('Reply "OK"');
    expect(txt).toContain('reply "1"');
  });

  it('renders price and expected value when price is provided', () => {
    const txt = formatPerItemSupplyMessage({
      outletName: 'Downtown',
      date: new Date('2025-10-15T08:30:00Z'),
      productName: 'goat',
      unit: 'kg',
      supplyQty: 22,
      openingQty: 5,
      sellPricePerUnit: 600,
    });
    expect(txt).toContain('💰 Price per kg: Ksh 600');
    // total = 27 * 600 = 16200
    expect(txt).toContain('🧮 Expected total value: Ksh 16,200');
    expect(txt).toContain('*(= (openingQty + supplyQty) × price per kg)*');
  });
});

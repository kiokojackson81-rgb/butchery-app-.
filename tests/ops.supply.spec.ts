import { describe, it, expect } from 'vitest';
import { formatSupplyForRole } from '@/lib/format/supply';

describe('formatSupplyForRole', () => {
  it('masks prices for attendant', () => {
    const view = {
      id: '1', outletName: 'Outlet A', supplierName: 'Sup', items: [{ name: 'P', qty: 2, unit: 'pcs', unitPrice: 100 }], totalQty: 2, totalCost: 200, status: 'submitted'
    } as any;
    const out = formatSupplyForRole(view, 'attendant');
    expect(out.totalCost).toBeUndefined();
    expect(out.items[0].unitPrice).toBeUndefined();
  });
  it('keeps prices for supervisor', () => {
    const view = {
      id: '1', outletName: 'Outlet A', supplierName: 'Sup', items: [{ name: 'P', qty: 2, unit: 'pcs', unitPrice: 100 }], totalQty: 2, totalCost: 200, status: 'submitted'
    } as any;
    const out = formatSupplyForRole(view, 'supervisor');
    expect(out.totalCost).toBe(200);
    expect(out.items[0].unitPrice).toBe(100);
  });
});

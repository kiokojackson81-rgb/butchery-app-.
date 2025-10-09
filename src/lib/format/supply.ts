// src/lib/format/supply.ts
import { } from "@/lib/prisma";

export type Role = 'supplier' | 'attendant' | 'supervisor' | 'admin';

export type SupplyItemView = {
  name: string;
  qty: number;
  unit: string;
  unitPrice?: number | null;
};

export type SupplyView = {
  id: string;
  outletName: string;
  supplierName: string;
  items: SupplyItemView[];
  totalQty: number;
  totalCost?: number;
  eta?: string | null;
  ref?: string | null;
  status: string;
};

export function formatSupplyForRole(view: SupplyView, role: Role): SupplyView {
  if (role === 'attendant') {
    return {
      ...view,
      totalCost: undefined,
      items: view.items.map((i) => ({ ...i, unitPrice: undefined })),
    };
  }
  return view;
}

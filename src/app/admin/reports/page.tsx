"use client";

import React, { useMemo, useState } from "react";

/** ========= Types ========= */
type ReportRow = {
  outlet: string;
  product: string;
  soldQty: number;
  grossSales: number;
  tillSales: number;
  wasteValue: number;
  expenses: number;
  approvedExcess: number;
  validatedDeposits: number;
  outstanding: number;
};

/** ========= Helpers ========= */
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

/** ========= Demo Data ========= */
const SAMPLE: ReportRow[] = [
  {
    outlet: "Bright",
    product: "Beef",
    soldQty: 20,
    grossSales: 14800,
    tillSales: 12000,
    wasteValue: 500,
    expenses: 300,
    approvedExcess: 0,
    validatedDeposits: 2500,
    outstanding: 0,
  },
  {
    outlet: "Baraka A",
    product: "Goat",
    soldQty: 15,
    grossSales: 13500,
    tillSales: 10000,
    wasteValue: 300,
    expenses: 200,
    approvedExcess: 0,
    validatedDeposits: 3000,
    outstanding: 0,
  },
];

/** ========= Component ========= */
export default function ReportsPage() {
  const [rows] = useState<ReportRow[]>(SAMPLE);

  // Aggregate by outlet
  const totals = useMemo(() => {
    const map = new Map<string, ReportRow>();
    rows.forEach((r) => {
      if (!map.has(r.outlet)) {
        map.set(r.outlet, { ...r });
      } else {
        const acc = map.get(r.outlet)!;
        acc.soldQty += toNum(r.soldQty);
        acc.grossSales += toNum(r.grossSales);
        acc.tillSales += toNum(r.tillSales);
        acc.wasteValue += toNum(r.wasteValue);
        acc.expenses += toNum(r.expenses);
        acc.approvedExcess += toNum(r.approvedExcess);
        acc.validatedDeposits += toNum(r.validatedDeposits);
        acc.outstanding += toNum(r.outstanding);
      }
    });
    return Array.from(map.values());
  }, [rows]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Admin Reports</h1>

      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-medium mb-3">Per Outlet Summary</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Outlet</th>
                <th className="p-2">Gross Sales</th>
                <th className="p-2">Till Sales</th>
                <th className="p-2">Waste (BP)</th>
                <th className="p-2">Expenses</th>
                <th className="p-2">Excess Approved</th>
                <th className="p-2">Deposits</th>
                <th className="p-2">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.outlet}</td>
                  <td className="p-2">{r.grossSales.toLocaleString()}</td>
                  <td className="p-2">{r.tillSales.toLocaleString()}</td>
                  <td className="p-2">{r.wasteValue.toLocaleString()}</td>
                  <td className="p-2">{r.expenses.toLocaleString()}</td>
                  <td className="p-2">{r.approvedExcess.toLocaleString()}</td>
                  <td className="p-2">{r.validatedDeposits.toLocaleString()}</td>
                  <td className="p-2">{r.outstanding.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border p-4">
        <h2 className="font-medium mb-3">Detailed Rows</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Outlet</th>
                <th className="p-2">Product</th>
                <th className="p-2">Qty Sold</th>
                <th className="p-2">Gross Sales</th>
                <th className="p-2">Till Sales</th>
                <th className="p-2">Waste</th>
                <th className="p-2">Expenses</th>
                <th className="p-2">Deposits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.outlet}</td>
                  <td className="p-2">{r.product}</td>
                  <td className="p-2">{r.soldQty}</td>
                  <td className="p-2">{r.grossSales.toLocaleString()}</td>
                  <td className="p-2">{r.tillSales.toLocaleString()}</td>
                  <td className="p-2">{r.wasteValue.toLocaleString()}</td>
                  <td className="p-2">{r.expenses.toLocaleString()}</td>
                  <td className="p-2">{r.validatedDeposits.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * Utilities
 */
const toNum = (v: any) => (typeof v === "number" ? v : v ? Number(v) : 0);
const ymd = (d: Date) => d.toISOString().split("T")[0];

/**
 * A safe group+sum helper that avoids the T[keyof T] numeric assignment issue.
 * Treats rows as dictionaries for the numeric fields you pass.
 */
function groupAndSum<T extends Record<string, any>>(
  rows: T[],
  byKey: keyof T,
  numericKeys: string[]
): T[] {
  const map = new Map<any, any>();

  for (const r of rows) {
    const k = r[byKey];
    if (!map.has(k)) {
      // clone shallowly and normalize numeric fields
      const base: Record<string, any> = { ...r };
      for (const n of numericKeys) base[n] = toNum(r[n]);
      map.set(k, base);
    } else {
      const acc = map.get(k) as Record<string, any>;
      for (const n of numericKeys) {
        acc[n] = toNum(acc[n]) + toNum(r[n]);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Dummy example rows so the page compiles even if your localStorage is empty.
 * You can replace these with your real data pull/compute when ready.
 */
type Row = {
  outlet: string;
  date: string;
  grossSales: number;
  tillSales: number;
  expenses: number;
  wasteValue: number;
  approvedExcess: number;
  validatedDeposits: number;
};

const SAMPLE: Row[] = [
  {
    outlet: "Bright",
    date: ymd(new Date()),
    grossSales: 7300,
    tillSales: 4000,
    expenses: 500,
    wasteValue: 0,
    approvedExcess: 0,
    validatedDeposits: 2700,
  },
  {
    outlet: "Baraka A",
    date: ymd(new Date()),
    grossSales: 5200,
    tillSales: 2600,
    expenses: 300,
    wasteValue: 100,
    approvedExcess: 0,
    validatedDeposits: 2200,
  },
];

export default function AdminReportsPage() {
  const [date, setDate] = useState(() => ymd(new Date()));
  const [tab, setTab] = useState<"summary" | "items" | "waste" | "supply" | "requests">("summary");

  // In your real app, replace SAMPLE with computed rows from storage
  const rows = SAMPLE;

  const byOutlet = useMemo(
    () =>
      groupAndSum(rows, "outlet", [
        "grossSales",
        "tillSales",
        "expenses",
        "wasteValue",
        "approvedExcess",
        "validatedDeposits",
      ]),
    [rows]
  );

  return (
    <main className="p-4 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold">Admin • Reports</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            className="border rounded-xl px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <TabBtn onClick={() => setTab("summary")} active={tab === "summary"}>
              Sales Summary
            </TabBtn>
            <TabBtn onClick={() => setTab("items")} active={tab === "items"}>
              Item Sales
            </TabBtn>
            <TabBtn onClick={() => setTab("waste")} active={tab === "waste"}>
              Waste
            </TabBtn>
            <TabBtn onClick={() => setTab("supply")} active={tab === "supply"}>
              View Supply
            </TabBtn>
            <TabBtn onClick={() => setTab("requests")} active={tab === "requests"}>
              Modification Requests
            </TabBtn>
          </div>
        </div>
      </header>

      {tab === "summary" && (
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold mb-2">Summary by Outlet</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left">Outlet</th>
                  <th className="p-2 text-right">Gross Sales</th>
                  <th className="p-2 text-right">Till Sales</th>
                  <th className="p-2 text-right">Expenses</th>
                  <th className="p-2 text-right">Waste</th>
                  <th className="p-2 text-right">Approved Excess</th>
                  <th className="p-2 text-right">Validated Deposits</th>
                </tr>
              </thead>
              <tbody>
                {byOutlet.map((r: any) => (
                  <tr key={r.outlet} className="border-b">
                    <td className="p-2">{r.outlet}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.grossSales).toLocaleString()}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.tillSales).toLocaleString()}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.expenses).toLocaleString()}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.wasteValue).toLocaleString()}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.approvedExcess).toLocaleString()}</td>
                    <td className="p-2 text-right">Ksh {toNum(r.validatedDeposits).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "items" && (
        <section className="rounded-2xl border p-3 text-sm text-gray-500">
          Item-level report can go here (kept simple for deployment).
        </section>
      )}

      {tab === "waste" && (
        <section className="rounded-2xl border p-3 text-sm text-gray-500">
          Waste records view (kept simple for deployment).
        </section>
      )}

      {tab === "supply" && (
        <section className="rounded-2xl border p-3 text-sm text-gray-500">
          Supply view (kept simple for deployment).
        </section>
      )}

      {tab === "requests" && (
        <section className="rounded-2xl border p-3 text-sm text-gray-500">
          Modification requests (kept simple for deployment).
        </section>
      )}
    </main>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl border text-sm ${
        active ? "bg-black text-white" : "bg-white"
      }`}
    >
      {children}
    </button>
  );
}

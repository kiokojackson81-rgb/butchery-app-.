"use client";

import React, { useMemo, useState } from "react";

/* =========================
   Helpers (no any)
   ========================= */
const toNum = (v: unknown): number =>
  typeof v === "number" ? v : v ? Number(v) : 0;

const ymd = (d: Date): string => d.toISOString().split("T")[0];

/* =========================
   Types
   ========================= */
type OutletName = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";

type ReportRow = {
  outlet: OutletName | string; // allow future outlets by name
  date: string;
  grossSales: number;
  tillSales: number;
  expenses: number;
  wasteValue: number;
  approvedExcess: number;
  validatedDeposits: number;
};

type SupplyRow = {
  itemKey: string;
  qty: number;
  unit: "kg" | "pcs";
};

type ModRequest = {
  id: string;
  date: string;
  outlet: string;
  itemKey: string;
  note: string;
};

/* =========================
   Demo data (safe fallback)
   Replace with real computed rows later.
   ========================= */
const SAMPLE_ROWS: ReportRow[] = [
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

/* =========================
   LocalStorage helpers (typed)
   ========================= */
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* Safe group+sum WITHOUT any/generics footguns.
   Aggregates by outlet. */
function groupByOutletSum(rows: ReportRow[]): ReportRow[] {
  const map = new Map<string, ReportRow>();
  for (const r of rows) {
    const k = String(r.outlet);
    const has = map.get(k);
    if (!has) {
      map.set(k, { ...r });
    } else {
      map.set(k, {
        outlet: has.outlet,
        date: has.date, // date not used in sum; keep first
        grossSales: has.grossSales + r.grossSales,
        tillSales: has.tillSales + r.tillSales,
        expenses: has.expenses + r.expenses,
        wasteValue: has.wasteValue + r.wasteValue,
        approvedExcess: has.approvedExcess + r.approvedExcess,
        validatedDeposits: has.validatedDeposits + r.validatedDeposits,
      });
    }
  }
  return Array.from(map.values());
}

export default function AdminReportsPage(): JSX.Element {
  const [date, setDate] = useState<string>(() => ymd(new Date()));
  const [tab, setTab] = useState<"summary" | "items" | "waste" | "supply" | "requests">(
    "summary",
  );

  // Replace SAMPLE_ROWS with your real computed data when ready.
  const rows: ReportRow[] = SAMPLE_ROWS;

  const byOutlet: ReportRow[] = useMemo(() => groupByOutletSum(rows), [rows]);

  // Supply view (read-only example: Bright for selected date)
  const supplyKey = `supplier_opening_${date}_Bright`;
  const supplyRows: SupplyRow[] = typeof window !== "undefined"
    ? readJSON<SupplyRow[]>(supplyKey, [])
    : [];

  const requestsKey = "attendant_mod_requests";
  const modRequests: ModRequest[] = typeof window !== "undefined"
    ? readJSON<ModRequest[]>(requestsKey, [])
    : [];

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

      {/* Summary by outlet */}
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
                {byOutlet.map((r) => (
                  <tr key={String(r.outlet)} className="border-b">
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
        <section className="rounded-2xl border p-3 text-sm text-gray-600">
          Item-level report placeholder (wire to your computed item sales later).
        </section>
      )}

      {tab === "waste" && (
        <section className="rounded-2xl border p-3 text-sm text-gray-600">
          Waste view placeholder (show per-item waste and value when ready).
        </section>
      )}

      {tab === "supply" && (
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold mb-2">Supply (Bright — {date})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">Unit</th>
                </tr>
              </thead>
              <tbody>
                {supplyRows.length === 0 && (
                  <tr>
                    <td className="p-2 text-gray-500" colSpan={3}>
                      No supply found in local storage for this day/outlet.
                    </td>
                  </tr>
                )}
                {supplyRows.map((s) => (
                  <tr key={`${s.itemKey}-${s.unit}`}>
                    <td className="p-2">{s.itemKey}</td>
                    <td className="p-2 text-right">{toNum(s.qty).toLocaleString()}</td>
                    <td className="p-2">{s.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "requests" && (
        <section className="rounded-2xl border p-3">
          <h2 className="font-semibold mb-2">Modification Requests</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Date</th>
                  <th className="p-2">Outlet</th>
                  <th className="p-2">Item</th>
                  <th className="p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {modRequests.length === 0 && (
                  <tr>
                    <td className="p-2 text-gray-500" colSpan={4}>
                      No modification requests yet.
                    </td>
                  </tr>
                )}
                {modRequests.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.outlet}</td>
                    <td className="p-2">{r.itemKey}</td>
                    <td className="p-2">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
}): JSX.Element {
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

"use client";

import React, { useEffect, useState } from "react";

/* =========================
   Types
   ========================= */
type Unit = "kg" | "pcs";

type ItemKey =
  | "beef"
  | "goat"
  | "liver"
  | "kuku"
  | "matumbo"
  | "potatoes"
  | "samosas"
  | "mutura";

interface SupplyRow {
  id: string;
  itemKey: ItemKey;
  qty: number;
  unit: Unit;
  assignedTo?: string;
}

interface TransferRow {
  id: string;
  fromOutlet: string;
  toOutlet: string;
  itemKey: ItemKey;
  qty: number;
  unit: Unit;
}

/* =========================
   Helpers
   ========================= */
function rid(): string {
  return Math.random().toString(36).slice(2);
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/* =========================
   Page
   ========================= */
export default function SupplierDashboardPage() {
  const [dateStr, setDateStr] = useState(today());
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

  /* Load saved supplies and transfers */
  useEffect(() => {
    setRows(readJSON<SupplyRow[]>(`supplier_opening_${dateStr}`, []));
    setTransfers(readJSON<TransferRow[]>(`supplier_transfers_${dateStr}`, []));
  }, [dateStr]);

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: rid(), itemKey: "beef", qty: 0, unit: "kg" },
    ]);

  const updateRow = (id: string, patch: Partial<SupplyRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const addTransfer = () =>
    setTransfers((prev) => [
      ...prev,
      {
        id: rid(),
        fromOutlet: "",
        toOutlet: "",
        itemKey: "beef",
        qty: 0,
        unit: "kg",
      },
    ]);

  const updateTransfer = (id: string, patch: Partial<TransferRow>) =>
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );

  const removeTransfer = (id: string) =>
    setTransfers((prev) => prev.filter((t) => t.id !== id));

  const save = () => {
    writeJSON(`supplier_opening_${dateStr}`, rows);
    writeJSON(`supplier_transfers_${dateStr}`, transfers);
    alert("Supply & Transfers saved.");
  };

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Supplier Dashboard</h1>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="border rounded-xl p-2 text-sm"
        />
      </header>

      {/* Supply Table */}
      <section className="rounded-2xl border p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Opening Supply</h2>
          <button
            onClick={addRow}
            className="border rounded-xl px-3 py-1 text-xs"
          >
            + Add Item
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b">
                <th className="p-2">Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Assigned To</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-2 text-gray-500">
                    No supply added yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2">{r.itemKey}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.qty}
                      onChange={(e) =>
                        updateRow(r.id, { qty: Number(e.target.value) })
                      }
                      className="border rounded-xl p-1 w-20"
                    />
                  </td>
                  <td>{r.unit}</td>
                  <td>
                    <input
                      type="text"
                      value={r.assignedTo ?? ""}
                      onChange={(e) =>
                        updateRow(r.id, { assignedTo: e.target.value })
                      }
                      placeholder="Code"
                      className="border rounded-xl p-1 w-32"
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => removeRow(r.id)}
                      className="text-xs border rounded-lg px-2 py-1"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Transfers Table */}
      <section className="rounded-2xl border p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Transfers</h2>
          <button
            onClick={addTransfer}
            className="border rounded-xl px-3 py-1 text-xs"
          >
            + Add Transfer
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b">
                <th className="p-2">From</th>
                <th>To</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-2 text-gray-500">
                    No transfers yet.
                  </td>
                </tr>
              )}
              {transfers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td>
                    <input
                      type="text"
                      value={t.fromOutlet}
                      onChange={(e) =>
                        updateTransfer(t.id, { fromOutlet: e.target.value })
                      }
                      placeholder="From outlet"
                      className="border rounded-xl p-1 w-32"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={t.toOutlet}
                      onChange={(e) =>
                        updateTransfer(t.id, { toOutlet: e.target.value })
                      }
                      placeholder="To outlet"
                      className="border rounded-xl p-1 w-32"
                    />
                  </td>
                  <td>{t.itemKey}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={t.qty}
                      onChange={(e) =>
                        updateTransfer(t.id, { qty: Number(e.target.value) })
                      }
                      className="border rounded-xl p-1 w-20"
                    />
                  </td>
                  <td>{t.unit}</td>
                  <td>
                    <button
                      onClick={() => removeTransfer(t.id)}
                      className="text-xs border rounded-lg px-2 py-1"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          onClick={save}
          className="px-4 py-2 rounded-2xl bg-black text-white"
        >
          Save
        </button>
      </div>
    </main>
  );
}

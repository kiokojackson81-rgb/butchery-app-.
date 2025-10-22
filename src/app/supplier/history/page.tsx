"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readJSON as safeLoad } from "@/utils/safeStorage";

// Re-use the storage key functions (duplicate small helpers to avoid cross-file import complexity)
const supplierOpeningKey = (date: string, outletName: string) => `supplier_opening_${date}_${outletName}`;
const supplierOpeningFullKey = (date: string, outletName: string) => `supplier_opening_full_${date}_${outletName}`;
const supplierTransfersKey = (date: string) => `supplier_transfers_${date}`;

function ymd(d = new Date()): string { return d.toISOString().split("T")[0]; }

type SupplyRow = { id: string; itemKey: string; qty: number; buyPrice: number; unit: "kg" | "pcs" };

type TransferRow = { id: string; date: string; fromOutletName: string; toOutletName: string; itemKey: string; qty: number; unit: "kg" | "pcs" };

export default function SupplierHistoryPage(): JSX.Element {
  const [fromDate, setFromDate] = useState<string>(ymd());
  const [toDate, setToDate] = useState<string>(ymd());
  // Initialize empty on server; populate from sessionStorage on client in useEffect
  const [outletName, setOutletName] = useState<string>("");
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [filterType, setFilterType] = useState<"all" | "supply" | "transfer">("all");
  const [filterItemKey, setFilterItemKey] = useState<string>("");

  useEffect(() => {
    // Populate outletName from client-only storage (sessionStorage) — avoid touching it during SSR
    if (typeof window === "undefined") return;
    const outletFromStorage = (sessionStorage.getItem("supplier_outlet") || "").trim();
    const supplierName = (sessionStorage.getItem("supplier_name") || "").trim();
    const candidates = [outletFromStorage, supplierName].map(s => (s || "").trim()).filter(Boolean);
    setOutletName(candidates[0] || "");
  }, []);

  // Load across a date range
  useEffect(() => {
    if (!outletName) return;
    const f = new Date(fromDate);
    const t = new Date(toDate);
    if (!(f <= t)) { setRows([]); setTransfers([]); return; }
    const days: string[] = [];
    for (let d = new Date(f); d <= t; d.setDate(d.getDate() + 1)) days.push(ymd(new Date(d)));
    (async () => {
      // Try server-backed supply history first
      try {
        const qs = new URLSearchParams({ from: days[0], to: days[days.length - 1], outlet: outletName, limit: "1000" });
        const r = await fetch(`/api/supply/history/all?${qs.toString()}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok && Array.isArray(j.rows)) {
            setRows(j.rows as any[]);
          }
        }
      } catch (e) {
        // fallback to local cache when server fails
        const accRows: SupplyRow[] = [];
        for (const d of days) {
          try {
            const full = safeLoad<SupplyRow[]>(supplierOpeningFullKey(d, outletName), []);
            if (Array.isArray(full) && full.length) accRows.push(...full.map(r => ({ ...r })));
          } catch {}
        }
        setRows(accRows);
      }

      // Transfers: try server-backed range endpoint first, fall back to per-day or local cache
      const accTx: TransferRow[] = [];
      try {
        const qs2 = new URLSearchParams({ from: days[0], to: days[days.length - 1], outlet: outletName });
        const rRange = await fetch(`/api/supply/transfer/range?${qs2.toString()}`, { cache: "no-store" });
        if (rRange.ok) {
          const jRange = await rRange.json();
          if (jRange?.ok && Array.isArray(jRange.rows)) {
            setTransfers(jRange.rows as any[]);
            return;
          }
        }
      } catch (e) {
        // If range fetch fails (or returns 401), fall back to existing behavior below
      }

      if (days.length <= 7) {
        for (const d of days) {
          try {
            const r2 = await fetch(`/api/supply/transfer?date=${encodeURIComponent(d)}&outlet=${encodeURIComponent(outletName)}`, { cache: "no-store" });
            if (r2.ok) {
              const j2 = await r2.json();
              if (j2?.ok && Array.isArray(j2.rows)) accTx.push(...j2.rows.map((x: any) => ({ ...x })));
            }
          } catch {}
        }
      } else {
        // fallback: read local cache for transfers if server-side fetching skipped
        for (const d of days) {
          try {
            const tx = safeLoad<TransferRow[]>(supplierTransfersKey(d), []);
            if (Array.isArray(tx) && tx.length) accTx.push(...tx.map(t => ({ ...t })));
          } catch {}
        }
      }
      setTransfers(accTx);
    })();
  }, [fromDate, toDate, outletName]);

  // CSV export helper
  // CSV field escaper
  const esc = (s: any) => {
    if (s === null || s === undefined) return "";
    const str = String(s);
    // Escape double quotes by doubling them, and wrap in quotes
    return '"' + str.replace(/"/g, '""') + '"';
  };

  const exportCsv = () => {
    const lines: string[] = [];
    lines.push(["Type", "Date", "Outlet", "From", "To", "Item", "Qty", "Unit", "BuyPrice"].map(esc).join(","));

    const supplyRows = filterType === "all" || filterType === "supply" ? rows.filter(r => !filterItemKey || r.itemKey.includes(filterItemKey)) : [];
    const transferRows = filterType === "all" || filterType === "transfer" ? transfers.filter(t => !filterItemKey || t.itemKey.includes(filterItemKey)) : [];

    for (const r of supplyRows) {
      lines.push(["supply", "", outletName, "", "", r.itemKey, String(r.qty), r.unit, String(r.buyPrice)].map(esc).join(","));
    }
    for (const t of transferRows) {
      lines.push(["transfer", t.date, "", t.fromOutletName, t.toOutletName, t.itemKey, String(t.qty), t.unit, ""].map(esc).join(","));
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supply-history-${outletName || "all"}-${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const totalKg = useMemo(() => rows.filter(r => r.unit === "kg").reduce((a, r) => a + (r.qty || 0), 0), [rows]);
  const totalPcs = useMemo(() => rows.filter(r => r.unit === "pcs").reduce((a, r) => a + (r.qty || 0), 0), [rows]);

  return (
    <main className="mobile-container p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Supply History</h1>
          <div className="flex gap-2">
            <Link href="/supplier/dashboard" className="border rounded-xl px-3 py-1 text-sm">Back</Link>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-1">View past supplies and transfers for the selected date/outlet (local cache).</p>
      </header>

      <section className="rounded-2xl border p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-gray-600">Outlet</label>
          <input className="input-mobile border rounded-xl p-2 text-sm" value={outletName} onChange={e => setOutletName(e.target.value)} placeholder="Outlet name" />
          <label className="text-xs text-gray-600">From</label>
          <input className="input-mobile border rounded-xl p-2 text-sm" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <label className="text-xs text-gray-600">To</label>
          <input className="input-mobile border rounded-xl p-2 text-sm" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          <label className="text-xs text-gray-600">Type</label>
          <select className="input-mobile border rounded-xl p-2 text-sm" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="all">All</option>
            <option value="supply">Supplies</option>
            <option value="transfer">Transfers</option>
          </select>
          <input className="input-mobile border rounded-xl p-2 text-sm" placeholder="Filter item key" value={filterItemKey} onChange={e => setFilterItemKey(e.target.value)} />
          <button className="border rounded-xl px-3 py-1 text-sm" onClick={exportCsv}>Export CSV</button>
        </div>

        <div className="mb-3">
          <h2 className="font-semibold">Opening Supply — {outletName || "—"} ({fromDate} → {toDate})</h2>
          {rows.length === 0 ? (
            <p className="text-gray-500">No opening supply rows for this date/outlet.</p>
          ) : (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-left border-b"><th>Item</th><th>Qty</th><th>Unit</th><th>Buy Price</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b"><td>{r.itemKey}</td><td>{r.qty}</td><td>{r.unit}</td><td>{r.buyPrice}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold"><td>Totals</td><td>{totalKg} kg / {totalPcs} pcs</td><td></td><td></td></tr>
              </tfoot>
            </table>
          )}
        </div>

        <div>
          <h2 className="font-semibold">Transfers — {fromDate} → {toDate}</h2>
          {new Date(toDate) > new Date(fromDate) && ((new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24) >= 7) && (
            <p className="text-xs text-yellow-600">Transfers are only fetched for ranges of 7 days or less; for larger ranges we read local cache.</p>
          )}
          {transfers.length === 0 ? (
            <p className="text-gray-500">No transfers recorded for this date range.</p>
          ) : (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-left border-b"><th>Date</th><th>From</th><th>To</th><th>Item</th><th>Qty</th></tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <tr key={t.id} className="border-b"><td>{t.date}</td><td>{t.fromOutletName}</td><td>{t.toOutletName}</td><td>{t.itemKey}</td><td>{t.qty}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <footer className="text-xs text-gray-600">Note: This view reads the local cache (saved drafts & transfers). Server-side history view can be added next.</footer>
    </main>
  );
}

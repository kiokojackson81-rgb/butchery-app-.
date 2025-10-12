"use client";

import React, { useEffect, useMemo, useState } from "react";

type Row = {
  date: string;
  outlet: string;
  itemKey: string;
  name: string;
  qty: number;
  unit: string;
  buyPrice: number;
  sellPrice?: number;
  totalBuy?: number;
  totalSell?: number;
  marginKsh?: number;
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function dateNDaysAgoISO(days: number) { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
function fmt(n: number | undefined | null) { const v = typeof n === "number" && isFinite(n) ? n : 0; return v.toLocaleString(); }

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function AdminSupplyHistoryPage() {
  const [from, setFrom] = useState(dateNDaysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [outlet, setOutlet] = useState("");
  const [sort, setSort] = useState<"date_desc"|"date_asc"|"outlet_asc"|"outlet_desc"|"name_asc"|"name_desc">("date_desc");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true); setError(null);
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (outlet.trim()) qs.set("outlet", outlet.trim());
      if (sort) qs.set("sort", sort);
      qs.set("limit", "500");
      const data = await getJSON<{ ok: boolean; rows: Row[] }>(`/api/supply/history/all?${qs.toString()}`);
      if (!data || data.ok !== true) throw new Error("Failed");
      setRows(data.rows || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totals = useMemo(() => {
    let qty = 0, buy = 0, sell = 0, margin = 0;
    for (const r of rows) {
      qty += Number(r.qty || 0);
      buy += Number(r.totalBuy || r.qty * r.buyPrice || 0);
      sell += Number(r.totalSell || (r.sellPrice != null ? r.qty * r.sellPrice : 0));
      const m = r.sellPrice != null ? (r.qty * (r.sellPrice - r.buyPrice)) : 0;
      margin += m;
    }
    return { qty, buy, sell, margin };
  }, [rows]);

  return (
    <main className="mobile-container p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Supply History</h1>
      <div className="rounded-2xl border p-4 mb-4">
        <div className="grid sm:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input className="input-mobile border rounded-xl p-2 w-full" type="date" value={from} onChange={e=>setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input className="input-mobile border rounded-xl p-2 w-full" type="date" value={to} onChange={e=>setTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Outlet</label>
            <input className="input-mobile border rounded-xl p-2 w-full" placeholder="All" value={outlet} onChange={e=>setOutlet(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sort</label>
            <select className="input-mobile border rounded-xl p-2 w-full" value={sort} onChange={e=>setSort(e.target.value as any)}>
              <option value="date_desc">Date ↓</option>
              <option value="date_asc">Date ↑</option>
              <option value="outlet_asc">Outlet A→Z</option>
              <option value="outlet_desc">Outlet Z→A</option>
              <option value="name_asc">Product A→Z</option>
              <option value="name_desc">Product Z→A</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-mobile px-3 py-2 rounded-xl border w-full" onClick={load} disabled={loading}>Apply</button>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Total Qty" value={fmt(totals.qty)} />
        <Stat label="Total Buy (Ksh)" value={`Ksh ${fmt(totals.buy)}`} />
        <Stat label="Total Sell (Ksh)" value={`Ksh ${fmt(totals.sell)}`} />
        <Stat label="Margin (Ksh)" value={`Ksh ${fmt(totals.margin)}`} />
      </div>

      <section className="rounded-2xl border p-4">
        <div className="table-wrap">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Date</th>
                <th>Outlet</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Buy/Unit</th>
                <th>Sell/Unit</th>
                <th>Total Buy</th>
                <th>Total Sell</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr><td className="py-2 text-red-700" colSpan={10}>{error}</td></tr>
              )}
              {!error && rows.length === 0 && (
                <tr><td className="py-2 text-gray-500" colSpan={10}>No records.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.date}-${r.outlet}-${r.itemKey}-${i}`} className="border-b">
                  <td className="py-2 whitespace-nowrap">{r.date}</td>
                  <td>{r.outlet}</td>
                  <td>{r.name}</td>
                  <td>{fmt(r.qty)}</td>
                  <td>{r.unit}</td>
                  <td>Ksh {fmt(r.buyPrice)}</td>
                  <td>{r.sellPrice != null ? `Ksh ${fmt(r.sellPrice)}` : "—"}</td>
                  <td>{r.totalBuy != null ? `Ksh ${fmt(r.totalBuy)}` : `Ksh ${fmt(r.qty * r.buyPrice)}`}</td>
                  <td>{r.totalSell != null ? `Ksh ${fmt(r.totalSell)}` : (r.sellPrice != null ? `Ksh ${fmt(r.qty * r.sellPrice)}` : "—")}</td>
                  <td>{r.sellPrice != null ? `Ksh ${fmt(r.qty * (r.sellPrice - r.buyPrice))}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-500 mt-3">
        Note: Supplier filter is not shown here because opening rows don’t store supplier attribution. For supplier-submitted orders, use supply.create views.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

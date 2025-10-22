"use client";

import React, { useEffect, useMemo, useState } from "react";
import { notifyToast, registerAdminToast } from '@/lib/toast';

type CommissionRow = {
  id: string;
  date: string;
  outletName: string;
  supervisorCode?: string | null;
  supervisorPhone?: string | null;
  salesKsh: number;
  expensesKsh: number;
  wasteKsh: number;
  profitKsh: number;
  commissionRate: number;
  commissionKsh: number;
  status?: string | null;
  note?: string | null;
};

type ApiResponse = {
  ok: boolean;
  period: { start: string; end: string; key: string };
  rows: CommissionRow[];
  totals: Record<string, { salesKsh: number; expensesKsh: number; wasteKsh: number; profitKsh: number; commissionKsh: number }>;
};

function todayISO(): string { return new Date().toISOString().slice(0,10); }

// Period utilities: 24th → 23rd (inclusive) with simple navigation
function ymdToDate(s: string): Date { return new Date(`${s}T00:00:00.000Z`); }
function toYMD(d: Date): string { return d.toISOString().slice(0,10); }
function commissionPeriodRange(d: Date): { start: string; end: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  let start = new Date(Date.UTC(y, m, 24));
  let end = new Date(Date.UTC(y, m + 1, 23));
  if (day < 24) { start = new Date(Date.UTC(y, m - 1, 24)); end = new Date(Date.UTC(y, m, 23)); }
  return { start: toYMD(start), end: toYMD(end) };
}
function periodLabel(pr: { start: string; end: string }) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = ymdToDate(pr.start); const e = ymdToDate(pr.end);
  return `${s.getUTCDate()} ${months[s.getUTCMonth()]} ${s.getUTCFullYear()} → ${e.getUTCDate()} ${months[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}
function prevPeriodStart(dstr: string): string {
  const pr = commissionPeriodRange(ymdToDate(dstr));
  const dayBefore = ymdToDate(pr.start); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return commissionPeriodRange(dayBefore).start;
}
function nextPeriodStart(dstr: string): string {
  const pr = commissionPeriodRange(ymdToDate(dstr));
  const dayAfter = ymdToDate(pr.end); dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return commissionPeriodRange(dayAfter).start;
}

export default function AdminCommissionsPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [supervisor, setSupervisor] = useState<string>("");
  const [outlet, setOutlet] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [bulkNote, setBulkNote] = useState<string>("");

  const rows = data?.rows || [];
  const period = data?.period || null;

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { try { registerAdminToast((m) => notifyToast(m)); } catch {} ; return () => { try { registerAdminToast(null); } catch {} } }, []);

  async function refresh() {
    try {
      setLoading(true); setError(null);
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (supervisor.trim()) qs.set("supervisor", supervisor.trim());
      if (outlet.trim()) qs.set("outlet", outlet.trim());
      if (status.trim()) qs.set("status", status.trim());
      const res = await fetch(`/api/commission?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed");
      setData(json as ApiResponse);
      setSelected({});
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  }

  const totals = useMemo(() => {
    const t = { sales: 0, expenses: 0, waste: 0, profit: 0, comm: 0 };
    for (const r of rows) {
      t.sales += r.salesKsh; t.expenses += r.expensesKsh; t.waste += r.wasteKsh; t.profit += r.profitKsh; t.comm += r.commissionKsh;
    }
    return t;
  }, [rows]);

  function toggle(id: string, on?: boolean) {
    setSelected((prev) => ({ ...prev, [id]: typeof on === 'boolean' ? on : !prev[id] }));
  }
  function toggleAll(on?: boolean) {
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.id] = typeof on === 'boolean' ? on : !(selected[r.id]);
    setSelected(next);
  }

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => !!selected[k]), [selected]);
  const selectedTotals = useMemo(() => {
    const set = new Set(selectedIds);
    let comm = 0;
    for (const r of rows) if (set.has(r.id)) comm += r.commissionKsh;
    return { comm };
  }, [selectedIds, rows]);

  async function markPaid() {
    if (!selectedIds.length) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/commission/mark-paid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: selectedIds, note: bulkNote || undefined }) });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Failed');
      await refresh();
    } catch (e: any) { setError(String(e?.message || e)); } finally { setLoading(false); }
  }

  async function markStatus(nextStatus: string) {
    if (!selectedIds.length) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/commission/mark-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: selectedIds, status: nextStatus, note: bulkNote || undefined }) });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Failed');
      await refresh();
    } catch (e: any) { setError(String(e?.message || e)); } finally { setLoading(false); }
  }

  function pdfUrl(): string {
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (supervisor.trim()) qs.set('supervisor', supervisor.trim());
    if (outlet.trim()) qs.set('outlet', outlet.trim());
    if (status.trim()) qs.set('status', status.trim());
    if (selectedIds.length) qs.set('ids', selectedIds.join(','));
    return `/api/commission/pdf?${qs.toString()}`;
  }
  function csvUrl(): string {
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (supervisor.trim()) qs.set('supervisor', supervisor.trim());
    if (outlet.trim()) qs.set('outlet', outlet.trim());
    if (status.trim()) qs.set('status', status.trim());
    if (selectedIds.length) qs.set('ids', selectedIds.join(','));
    return `/api/commission/csv?${qs.toString()}`;
  }

  return (
    <main className="mobile-container p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Supervisor Commissions</h1>
      {period ? (
        <p className="text-sm text-gray-300 mb-4">Period: {period.start} → {period.end}</p>
      ) : null}

      <section className="rounded-2xl border p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-300">Date (for period)</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs border rounded px-2 py-1"
                title="Previous period"
                onClick={() => setDate(prevPeriodStart(date))}
              >← Prev</button>
              <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="border rounded px-2 py-1 bg-transparent" />
              {(() => {
                const today = new Date();
                const nextStart = nextPeriodStart(date);
                const todayPr = commissionPeriodRange(today);
                const nextDisabled = nextStart > todayPr.start; // avoid navigating beyond current period
                return (
                  <button
                    type="button"
                    className="text-xs border rounded px-2 py-1 disabled:opacity-50"
                    title="Next period"
                    disabled={nextDisabled}
                    onClick={() => { if (!nextDisabled) setDate(nextStart); }}
                  >Next →</button>
                );
              })()}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">{periodLabel(commissionPeriodRange(ymdToDate(date)))}</div>
          </div>
          <div>
            <label className="block text-xs text-gray-300">Supervisor Code</label>
            <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="e.g. SUP123" className="border rounded px-2 py-1 bg-transparent" />
          </div>
          <div>
            <label className="block text-xs text-gray-300">Outlet</label>
            <input value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="e.g. Bright" className="border rounded px-2 py-1 bg-transparent" />
          </div>
          <div>
            <label className="block text-xs text-gray-300">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1 bg-transparent">
              <option value="">(any)</option>
              <option value="calculated">calculated</option>
              <option value="adjusted">adjusted</option>
              <option value="approved">approved</option>
              <option value="paid">paid</option>
            </select>
          </div>
          <button onClick={refresh} disabled={loading} className="bg-blue-600 text-white px-3 py-2 rounded">{loading ? 'Loading…' : 'Refresh'}</button>
          <a href={pdfUrl()} target="_blank" rel="noreferrer" className="bg-gray-700 text-white px-3 py-2 rounded">Download PDF</a>
          <a href={csvUrl()} target="_blank" rel="noreferrer" className="bg-gray-700 text-white px-3 py-2 rounded">Download CSV</a>
          <div>
            <label className="block text-xs text-gray-300">Note (optional)</label>
            <input value={bulkNote} onChange={(e)=>setBulkNote(e.target.value)} placeholder="e.g., Paid via M-Pesa REF..." className="border rounded px-2 py-1 w-64 bg-transparent" />
          </div>
          <button onClick={markPaid} disabled={loading || selectedIds.length === 0} className="bg-green-600 text-white px-3 py-2 rounded">Mark Paid ({selectedIds.length})</button>
          <button onClick={() => markStatus('approved')} disabled={loading || selectedIds.length === 0} className="bg-emerald-600 text-white px-3 py-2 rounded">Mark Approved</button>
          <button onClick={() => markStatus('calculated')} disabled={loading || selectedIds.length === 0} className="bg-slate-600 text-white px-3 py-2 rounded">Reset to Calculated</button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
      </section>

      <section className="rounded-2xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-300">
            Totals — Sales: Ksh {totals.sales.toLocaleString()} · Expenses: Ksh {totals.expenses.toLocaleString()} · Waste: Ksh {totals.waste.toLocaleString()} · Profit: Ksh {totals.profit.toLocaleString()} · Commission: Ksh {totals.comm.toLocaleString()}
            {selectedIds.length > 0 && (
              <span className="ml-3 text-gray-300">Selected Commission: Ksh {selectedTotals.comm.toLocaleString()}</span>
            )}
          </div>
          <div>
            <button onClick={() => toggleAll(true)} className="text-sm mr-2 underline">Select all</button>
            <button onClick={() => toggleAll(false)} className="text-sm underline">Clear</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="w-full text-sm border border-white/10">
            <thead>
              <tr className="text-left bg-white/10 text-white">
                <th className="p-2">Sel</th>
                <th className="p-2">Date</th>
                <th className="p-2">Outlet</th>
                <th className="p-2">Supervisor</th>
                <th className="p-2">Sales</th>
                <th className="p-2">Expenses</th>
                <th className="p-2">Waste</th>
                <th className="p-2">Profit</th>
                <th className="p-2">Rate</th>
                <th className="p-2">Commission</th>
                <th className="p-2">Status</th>
                <th className="p-2">Note</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="p-2 align-top"><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => toggle(r.id, e.target.checked)} /></td>
                  <td className="p-2 align-top">{r.date}</td>
                  <td className="p-2 align-top">{r.outletName}</td>
                  <td className="p-2 align-top">{r.supervisorCode || "—"}</td>
                  <td className="p-2 align-top">{r.salesKsh.toLocaleString()}</td>
                  <td className="p-2 align-top">{r.expensesKsh.toLocaleString()}</td>
                  <td className="p-2 align-top">{r.wasteKsh.toLocaleString()}</td>
                  <td className="p-2 align-top">{r.profitKsh.toLocaleString()}</td>
                  <td className="p-2 align-top">{(r.commissionRate * 100).toFixed(1)}%</td>
                  <td className="p-2 align-top">{r.commissionKsh.toLocaleString()}</td>
                  <td className="p-2 align-top">{r.status || "calculated"}</td>
                  <td className="p-2 align-top break-words max-w-[16rem]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300">{r.note || "—"}</span>
                      <button
                        className="text-xs underline"
                        onClick={async () => {
                          const val = window.prompt("Edit note", r.note || "");
                          if (val === null) return;
                          try {
                            const res = await fetch('/api/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id, note: val }) });
                            const json = await res.json();
                            if (!json?.ok) throw new Error(json?.error || 'Failed');
                            await refresh();
                          } catch (e) {
                            try { notifyToast('Failed to update note'); } catch {}
                          }
                        }}
                      >Edit</button>
                    </div>
                  </td>
                  <td className="p-2 align-top whitespace-nowrap">
                    <button
                      className="text-xs border rounded px-2 py-1 mr-1"
                      onClick={() => markStatus('approved').catch(()=>{})}
                      title="Mark this row approved"
                    >Approve</button>
                    <button
                      className="text-xs border rounded px-2 py-1"
                      onClick={async () => { setSelected({ [r.id]: true }); await markPaid(); setSelected({}); }}
                      title="Mark this row paid"
                    >Pay</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

type OutletPerf = {
  id: string; date: string; outletName: string;
  totalSales: number; totalCost: number; grossProfit: number; expenses: number; netProfit: number;
  deposits: number; expectedDeposit: number; deficit: number; variancePct: number; wasteCost: number; wastePct: number;
};

type AttendantKPI = {
  id: string; date: string; outletName: string; attendantId: string;
  sales: number; gp: number; expenses: number; np: number; salaryDay: number; roiVsSalary: number;
  wasteCost: number; wastePct: number; depositExpected: number; depositActual: number; depositGap: number; redFlags?: string[];
};

type WasteRow = { outletName: string; productKey: string; wasteQty: number; wasteValue: number };
type IntervalRow = {
  id: string; outletName: string; productKey: string; startedAt: string; endedAt?: string | null;
  openingQty: number; addlSupplyQty: number; salesQty: number; wasteQty: number; closingQty: number;
  avgDailyVelocity: number; sellThroughPct: number; revenue: number; costOfGoods: number; grossProfit: number; gpPct: number;
  depositExpected: number; depositActual: number; depositGap: number; priceChanges: number; notes?: string | null;
};

function ymd() { return new Date().toISOString().slice(0, 10); }
function fmt(n: any, digits = 0) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function PerformancePage() {
  const [tab, setTab] = useState<"outlets"|"attendants"|"waste"|"intervals">("outlets");
  const [from, setFrom] = useState<string>(ymd());
  const [to, setTo] = useState<string>(ymd());
  const [date, setDate] = useState<string>(ymd()); // for waste tab
  const [outlet, setOutlet] = useState<string>("");
  const [product, setProduct] = useState<string>("");

  const [outletRows, setOutletRows] = useState<OutletPerf[]>([]);
  const [attRows, setAttRows] = useState<AttendantKPI[]>([]);
  const [wasteRows, setWasteRows] = useState<WasteRow[]>([]);
  const [intRows, setIntRows] = useState<IntervalRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function pdfUrl(): string {
    const sp = new URLSearchParams();
    // For outlets/attendants tabs: use range; for waste: include date
    if (tab === 'waste') {
      if (date) sp.set('date', date);
    } else {
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
    }
    if (outlet) sp.set('outlet', outlet);
    if (tab === 'intervals' && product) sp.set('product', product);
    return `/api/performance/pdf?${sp.toString()}`;
  }

  async function loadOutlets() {
    setLoading(true); setErr(null);
    try {
      const sp = new URLSearchParams();
      if (from) sp.set("from", from); if (to) sp.set("to", to); if (outlet) sp.set("outlet", outlet);
      const r = await fetch(`/api/performance/outlets?${sp.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setOutletRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) { setErr(String(e?.message || e)); setOutletRows([]); }
    finally { setLoading(false); }
  }
  async function loadAttendants() {
    setLoading(true); setErr(null);
    try {
      const sp = new URLSearchParams();
      if (from) sp.set("from", from); if (to) sp.set("to", to); if (outlet) sp.set("outlet", outlet);
      const r = await fetch(`/api/performance/attendants?${sp.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setAttRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) { setErr(String(e?.message || e)); setAttRows([]); }
    finally { setLoading(false); }
  }
  async function loadWaste() {
    setLoading(true); setErr(null);
    try {
      const sp = new URLSearchParams();
      if (date) sp.set("date", date); if (outlet) sp.set("outlet", outlet);
      const r = await fetch(`/api/performance/waste?${sp.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setWasteRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) { setErr(String(e?.message || e)); setWasteRows([]); }
    finally { setLoading(false); }
  }
  async function loadIntervals() {
    setLoading(true); setErr(null);
    try {
      const sp = new URLSearchParams(); if (outlet) sp.set('outlet', outlet); if (product) sp.set('product', product);
      const r = await fetch(`/api/intervals/list?${sp.toString()}`, { cache: 'no-store' });
      const j = await r.json(); if (!j?.ok) throw new Error(j?.error || 'Failed');
      setIntRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) { setErr(String(e?.message || e)); setIntRows([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (tab === 'outlets') loadOutlets(); }, [tab, from, to, outlet]);
  useEffect(() => { if (tab === 'attendants') loadAttendants(); }, [tab, from, to, outlet]);
  useEffect(() => { if (tab === 'waste') loadWaste(); }, [tab, date, outlet]);
  useEffect(() => { if (tab === 'intervals') loadIntervals(); }, [tab, outlet, product]);

  const outletAgg = useMemo(() => outletRows.reduce((a, r) => {
    a.sales += Number(r.totalSales||0); a.exp += Number(r.expenses||0); a.np += Number(r.netProfit||0);
    a.dep += Number(r.deposits||0); a.expDep += Number(r.expectedDeposit||0); a.def += Number(r.deficit||0);
    a.waste += Number(r.wasteCost||0); return a;
  }, { sales:0, exp:0, np:0, dep:0, expDep:0, def:0, waste:0 }), [outletRows]);

  return (
    <main className="mobile-container sticky-safe p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-gray-600">Outlets, attendants, waste and supply intervals.</p>
        </div>
        <div className="flex items-center gap-2 mobile-scroll-x">
          {tab !== 'waste' ? (
            <>
              <input className="input-mobile border rounded-xl p-2 text-sm" type="date" value={from} onChange={e=>setFrom(e.target.value)} />
              <span className="text-xs text-gray-500">→</span>
              <input className="input-mobile border rounded-xl p-2 text-sm" type="date" value={to} onChange={e=>setTo(e.target.value)} />
            </>
          ) : (
            <input className="input-mobile border rounded-xl p-2 text-sm" type="date" value={date} onChange={e=>setDate(e.target.value)} />
          )}
          <input className="input-mobile border rounded-xl p-2 text-sm w-48" placeholder="Outlet (optional)" value={outlet} onChange={e=>setOutlet(e.target.value)} />
          {tab === 'intervals' && (
            <input className="input-mobile border rounded-xl p-2 text-sm w-40" placeholder="Product key (optional)" value={product} onChange={e=>setProduct(e.target.value)} />
          )}
          <a href={pdfUrl()} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl border text-sm">Download PDF</a>
        </div>
      </header>

      <nav className="flex gap-2 mb-4 mobile-scroll-x">
        {([['outlets','Outlets'],['attendants','Attendants'],['waste','Waste'],['intervals','Intervals']] as const).map(([k, label]) => (
          <button key={k} onClick={()=>setTab(k as any)} className={`px-3 py-1.5 rounded-xl border text-sm ${tab===k? 'bg-black text-white':''}`}>{label}</button>
        ))}
      </nav>

      {err && <div className="text-red-600 text-sm mb-3">{err}</div>}

      {tab === 'outlets' && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Outlet Performance</h2>
          <div className="text-sm text-gray-700 mb-2">Totals — Sales: Ksh {fmt(outletAgg.sales)} · Expenses: Ksh {fmt(outletAgg.exp)} · Net Profit: Ksh {fmt(outletAgg.np)} · Deposits: Ksh {fmt(outletAgg.dep)} · Expected: Ksh {fmt(outletAgg.expDep)} · Deficit: Ksh {fmt(outletAgg.def)} · Waste: Ksh {fmt(outletAgg.waste)}</div>
          <div className="table-wrap">
            <table className="w-full text-sm border">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Date</th>
                  <th className="p-2">Outlet</th>
                  <th className="p-2">Sales</th>
                  <th className="p-2">Expenses</th>
                  <th className="p-2">Net Profit</th>
                  <th className="p-2">Deposits</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Deficit</th>
                  <th className="p-2">Waste</th>
                </tr>
              </thead>
              <tbody>
                {outletRows.length === 0 ? (
                  <tr><td className="p-2 text-gray-500" colSpan={9}>{loading? 'Loading…' : 'No rows'}</td></tr>
                ) : outletRows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.outletName}</td>
                    <td className="p-2">Ksh {fmt(r.totalSales)}</td>
                    <td className="p-2">Ksh {fmt(r.expenses)}</td>
                    <td className="p-2">Ksh {fmt(r.netProfit)}</td>
                    <td className="p-2">Ksh {fmt(r.deposits)}</td>
                    <td className="p-2">Ksh {fmt(r.expectedDeposit)}</td>
                    <td className="p-2">Ksh {fmt(r.deficit)}</td>
                    <td className="p-2">Ksh {fmt(r.wasteCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'attendants' && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Attendant KPIs</h2>
          <div className="table-wrap">
            <table className="w-full text-sm border">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Date</th>
                  <th className="p-2">Outlet</th>
                  <th className="p-2">Sales</th>
                  <th className="p-2">NP</th>
                  <th className="p-2">Salary/day</th>
                  <th className="p-2">ROI vs Salary</th>
                  <th className="p-2">Deposit Gap</th>
                  <th className="p-2">Red Flags</th>
                </tr>
              </thead>
              <tbody>
                {attRows.length === 0 ? (
                  <tr><td className="p-2 text-gray-500" colSpan={8}>{loading? 'Loading…' : 'No rows'}</td></tr>
                ) : attRows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.outletName}</td>
                    <td className="p-2">Ksh {fmt(r.sales)}</td>
                    <td className="p-2">Ksh {fmt(r.np)}</td>
                    <td className="p-2">Ksh {fmt(r.salaryDay)}</td>
                    <td className="p-2">{fmt(r.roiVsSalary, 2)}x</td>
                    <td className="p-2">Ksh {fmt(r.depositGap)}</td>
                    <td className="p-2">{Array.isArray(r.redFlags) && r.redFlags.length ? r.redFlags.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'waste' && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Waste — {date}{outlet? ` · ${outlet}`: ''}</h2>
          <div className="table-wrap">
            <table className="w-full text-sm border">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Outlet</th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Waste Qty</th>
                  <th className="p-2">Waste Value</th>
                </tr>
              </thead>
              <tbody>
                {wasteRows.length === 0 ? (
                  <tr><td className="p-2 text-gray-500" colSpan={4}>{loading? 'Loading…' : 'No rows'}</td></tr>
                ) : wasteRows.map((r, i) => (
                  <tr key={`${r.outletName}-${r.productKey}-${i}`} className="border-b">
                    <td className="p-2">{r.outletName}</td>
                    <td className="p-2"><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{r.productKey}</code></td>
                    <td className="p-2">{fmt(r.wasteQty)}</td>
                    <td className="p-2">Ksh {fmt(r.wasteValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'intervals' && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Supply Intervals{outlet? ` — ${outlet}`:''}</h2>
          <div className="table-wrap">
            <table className="w-full text-sm border">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Outlet</th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Start</th>
                  <th className="p-2">End</th>
                  <th className="p-2">Sales Qty</th>
                  <th className="p-2">Waste Qty</th>
                  <th className="p-2">Revenue</th>
                  <th className="p-2">GP</th>
                  <th className="p-2">GP%</th>
                  <th className="p-2">Deposit Gap</th>
                </tr>
              </thead>
              <tbody>
                {intRows.length === 0 ? (
                  <tr><td className="p-2 text-gray-500" colSpan={10}>{loading? 'Loading…' : 'No rows'}</td></tr>
                ) : intRows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.outletName}</td>
                    <td className="p-2"><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{r.productKey}</code></td>
                    <td className="p-2">{new Date(r.startedAt).toISOString().slice(0,19).replace('T',' ')}</td>
                    <td className="p-2">{r.endedAt ? new Date(r.endedAt).toISOString().slice(0,19).replace('T',' ') : '—'}</td>
                    <td className="p-2">{fmt(r.salesQty)}</td>
                    <td className="p-2">{fmt(r.wasteQty)}</td>
                    <td className="p-2">Ksh {fmt(r.revenue)}</td>
                    <td className="p-2">Ksh {fmt(r.grossProfit)}</td>
                    <td className="p-2">{fmt(r.gpPct, 2)}%</td>
                    <td className="p-2">Ksh {fmt(r.depositGap)}</td>
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

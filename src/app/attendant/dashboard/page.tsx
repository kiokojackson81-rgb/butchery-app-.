// src/app/attendant/dashboard/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { hydrateLocalStorageFromDB } from "@/lib/settingsBridge";

/** ========= Types ========= */
type Unit = "kg" | "pcs";
type ItemKey =
  | "beef" | "goat" | "liver" | "kuku" | "matumbo"
  | "potatoes" | "samosas" | "mutura";

type Row = { key: ItemKey; name: string; unit: Unit; opening: number; closing: number | ""; waste: number | "" };
type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";
type Deposit = { id: string; code: string; amount: number | ""; note?: string; status?: "VALID"|"PENDING"|"INVALID" };
type AdminProduct = { key: ItemKey; name: string; unit: Unit; sellPrice: number; active: boolean; };
type AdminOutlet = { name: string; code: string; active: boolean };
type TillPaymentRow = { time: string; amount: number; code?: string | null; customer?: string; ref?: string };

/** ========= Keys (unchanged) ========= */
const ADMIN_OUTLETS_KEY = "admin_outlets";
const ADMIN_PRODUCTS_KEY = "admin_products";

const supplierOpeningKey = (date: string, outlet: string) => `supplier_opening_${date}_${outlet}`;
const attClosingKey   = (date: string, outlet: string) => `attendant_closing_${date}_${outlet}`;
const attWasteKey     = (date: string, outlet: string) => `attendant_waste_${date}_${outlet}`;
const depositKey      = (date: string, outlet: string) => `attendant_deposit_${date}_${outlet}`; // legacy total
const depositsKey     = (date: string, outlet: string) => `attendant_deposits_${date}_${outlet}`;
const expensesKey     = (date: string, outlet: string) => `attendant_expenses_${date}_${outlet}`;
const countedTillKey  = (date: string, outlet: string) => `attendant_tillcount_${date}_${outlet}`;
const summaryKey      = (date: string, outlet: string) => `attendant_summary_${date}_${outlet}`;

const SCOPE_KEY = "attendant_scope";
const PRICEBOOK_KEY = "admin_pricebook";

/** ========= Helpers ========= */
function toNum(v: number | "" | undefined) { return typeof v === "number" ? v : v ? Number(v) : 0; }
function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function today() { return new Date().toISOString().split("T")[0]; }
function id() { return Math.random().toString(36).slice(2); }
function readJSON<T>(k: string, fallback: T): T {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function writeJSON(k: string, v: any) { localStorage.setItem(k, JSON.stringify(v)); }

/** ========= Waste helper ========= */
function askWaste(unit: Unit, current: number | ""): number | null {
  const init = current === "" ? "" : String(current);
  const raw = window.prompt(`Enter waste in ${unit}`, init) ?? "";
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) { alert("Enter a non-negative number"); return null; }
  return n;
}

/** ========= small fetch helpers ========= */
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function AttendantDashboardPage() {
  const [dateStr] = useState(today()); // locked to today
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [catalog, setCatalog] = useState<Record<ItemKey, AdminProduct>>({} as any);

  const [rows, setRows] = useState<Row[]>([]);
  const [openingRowsRaw, setOpeningRowsRaw] = useState<Array<{ itemKey: ItemKey; qty: number }>>([]);

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [expenses, setExpenses] = useState<Array<{ id: string; name: string; amount: number | "" }>>([]);
  const [countedTill, setCountedTill] = useState<number | "">("");

  const [tab, setTab] = useState<"stock" | "supply" | "deposits" | "expenses" | "till" | "summary">("stock");
  const [submitted, setSubmitted] = useState(false);

  // Thin persistence: ensure admin settings are hydrated from DB first
  useEffect(() => {
    (async () => {
      try { await hydrateLocalStorageFromDB(); } catch {}
    })();
  }, []);

  // Trading period + header KPIs
  const [periodStartAt, setPeriodStartAt] = useState<string | null>(null);
  const [kpi, setKpi] = useState<{ weightSales: number; expenses: number; todayTotalSales: number; tillSalesNet: number; tillSalesGross: number; verifiedDeposits: number; amountToDeposit: number }>({
    weightSales: 0, expenses: 0, todayTotalSales: 0, tillSalesNet: 0, tillSalesGross: 0, verifiedDeposits: 0, amountToDeposit: 0,
  });
  const [tillRows, setTillRows] = useState<TillPaymentRow[]>([]);
  const [tillTotal, setTillTotal] = useState(0);

  /** ===== Resolve outlet + products ===== */
  useEffect(() => {
    const rawOutlets = localStorage.getItem(ADMIN_OUTLETS_KEY);
    const code = sessionStorage.getItem("attendant_code") || "";
    try {
      if (rawOutlets && code) {
        const list = JSON.parse(rawOutlets) as AdminOutlet[];
        const found = list.find(o => o.active && o.code && code.trim().toLowerCase() === o.code.trim().toLowerCase());
        if (found) setOutlet(found.name as Outlet);
      }
    } catch {}

    const rawProd = localStorage.getItem(ADMIN_PRODUCTS_KEY);
    if (rawProd) {
      const arr = JSON.parse(rawProd) as AdminProduct[];
      const map = arr.filter(p => p.active).reduce((acc, p) => { acc[p.key as ItemKey] = p; return acc; }, {} as Record<ItemKey, AdminProduct>);
      setCatalog(map);
    }
  }, []);

  /** ===== Scope & pricebook overlays (unchanged) ===== */
  useEffect(() => {
    const code = sessionStorage.getItem("attendant_code") || "";
    if (!code) return;
    try {
      const raw = localStorage.getItem(SCOPE_KEY);
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, { outlet: Outlet; productKeys: ItemKey[] }>;
      const scope = map[code];
      if (!scope) return;

      setOutlet(scope.outlet as Outlet);

      setCatalog(prev => {
        const keys = Object.keys(prev) as ItemKey[];
        const wanted = new Set(scope.productKeys);
        const alreadyScoped = keys.every(k => wanted.has(k)) && keys.length === scope.productKeys.length;
        if (alreadyScoped) return prev;
        const filtered = {} as Record<ItemKey, AdminProduct>;
        scope.productKeys.forEach(k => { if (prev[k]) filtered[k] = prev[k]; });
        return filtered;
      });
    } catch {}
  }, [catalog]);

  useEffect(() => {
    if (!outlet) return;
    try {
      const raw = localStorage.getItem(PRICEBOOK_KEY);
      if (!raw) return;
      const all = JSON.parse(raw) as Record<string, Record<ItemKey, { sellPrice: number; active: boolean }>>;
      const pb = all[outlet];
      if (!pb) return;

      setCatalog(prev => {
        let changed = false;
        const next: Record<ItemKey, AdminProduct> = { ...prev };
        (Object.keys(prev) as ItemKey[]).forEach(k => {
          const row = pb[k];
          if (!row) return;
          if (row.active === false) {
            if (k in next) { delete next[k]; changed = true; }
          } else {
            const curr = next[k];
            if (curr && Number(row.sellPrice ?? curr.sellPrice) !== Number(curr.sellPrice)) {
              next[k] = { ...curr, sellPrice: Number(row.sellPrice ?? curr.sellPrice) };
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    } catch {}
  }, [outlet]);

  /** ===== Load opening + saved data ===== */
  useEffect(() => {
    if (!outlet) return;

    const openingRows = readJSON<Array<{ itemKey: ItemKey; qty: number }>>(supplierOpeningKey(dateStr, outlet), []);
    setOpeningRowsRaw(openingRows || []);

    const byItem: Record<ItemKey, number> = {} as any;
    (openingRows || []).forEach(r => { byItem[r.itemKey] = (byItem[r.itemKey] || 0) + Number(r.qty || 0); });
    const built: Row[] = (Object.keys(byItem) as ItemKey[])
      .filter(k => !!catalog[k])
      .map(k => {
        const key = k as ItemKey; const prod = catalog[key];
        return { key, name: prod?.name || key.toUpperCase(), unit: prod?.unit || "kg", opening: byItem[key] || 0, closing: "", waste: "" };
      });
    setRows(built);

    // deposits
    const depListRaw = localStorage.getItem(depositsKey(dateStr, outlet));
    if (depListRaw) {
      const arr = JSON.parse(depListRaw) as Deposit[];
      setDeposits(arr.map(d => ({ ...d, id: d.id || id() })));
    } else {
      const depRaw = localStorage.getItem(depositKey(dateStr, outlet));
      if (depRaw) {
        const total = Number(JSON.parse(depRaw) || 0);
        setDeposits(total > 0 ? [{ id: id(), code: "", amount: total, note: "" }] : []);
      } else setDeposits([]);
    }

    // expenses
    const exRaw = localStorage.getItem(expensesKey(dateStr, outlet));
    if (exRaw) {
      const ex = JSON.parse(exRaw) as Array<{ name: string; amount: number }>;
      setExpenses(ex.map(e => ({ id: id(), name: e.name, amount: e.amount })));
    } else setExpenses([]);

    // till count
    const t = localStorage.getItem(countedTillKey(dateStr, outlet));
    setCountedTill(t ? Number(t) : "");

    // API-backed bits
    refreshPeriodAndHeader(outlet).catch(()=>{});
    refreshTill(outlet).catch(()=>{});
    setSubmitted(false);
  }, [dateStr, outlet, catalog]);

  /** ===== Client-side expected totals (unchanged) ===== */
  const sellPrice = (k: ItemKey) => Number(catalog[k]?.sellPrice || 0);
  const computed = useMemo(() => {
    const perItem = rows.map(r => {
      const closing = toNum(r.closing);
      const waste = toNum(r.waste);
      const soldQty = Math.max(0, r.opening - closing - waste);
      const expectedKsh = soldQty * sellPrice(r.key);
      return { ...r, soldQty, expectedKsh };
    });
    const expectedKsh = perItem.reduce((a, r) => a + r.expectedKsh, 0);
    const depositedKsh = deposits.reduce((a, d) => a + toNum(d.amount), 0);
    const expensesKsh = expenses.reduce((a, e) => a + toNum(e.amount), 0);
    const projectedTill = expectedKsh - depositedKsh - expensesKsh;
    const counted = toNum(countedTill);
    const varianceKsh = counted - projectedTill;
    return { perItem, expectedKsh, depositedKsh, expensesKsh, projectedTill, counted, varianceKsh };
  }, [rows, deposits, expenses, countedTill, catalog]);

  /** ===== Handlers ===== */
  const setClosing = (key: ItemKey, v: number | "") =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, closing: v } : r));
  const setWaste   = (key: ItemKey, v: number | "") =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, waste: v } : r));

  // deposits
  const addDeposit = () => setDeposits(prev => [...prev, { id: id(), code: "", amount: "", note: "" }]);
  const rmDeposit  = (did: string) => setDeposits(prev => prev.filter(d => d.id !== did));
  const upDeposit  = (did: string, patch: Partial<Deposit>) =>
    setDeposits(prev => prev.map(d => d.id === did ? { ...d, ...patch } : d));

  // expenses
  const addExpense = () => setExpenses(prev => [...prev, { id: id(), name: "", amount: "" }]);
  const rmExpense  = (eid: string) => setExpenses(prev => prev.filter(e => e.id !== eid));
  const upExpense  = (eid: string, patch: Partial<{name: string; amount: number | ""}>) =>
    setExpenses(prev => prev.map(e => e.id === eid ? { ...e, ...patch } : e));

  // stock submit: save + rotate period
  const submitStock = async () => {
    if (!outlet) return;

    const closingMap: Record<string, number> = {};
    const wasteMap: Record<string, number> = {};
    rows.forEach(r => { closingMap[r.key] = toNum(r.closing); wasteMap[r.key] = toNum(r.waste); });
    writeJSON(attClosingKey(dateStr, outlet), closingMap);
    writeJSON(attWasteKey(dateStr, outlet), wasteMap);
    writeJSON(depositsKey(dateStr, outlet), deposits.filter(d => toNum(d.amount) > 0 || (d.code || "").trim() !== ""));
    writeJSON(expensesKey(dateStr, outlet), expenses.filter(e => (e.name || "").trim() !== "" && toNum(e.amount) > 0)
      .map(e => ({ name: e.name.trim(), amount: toNum(e.amount) })));
    writeJSON(countedTillKey(dateStr, outlet), toNum(countedTill));
    writeJSON(summaryKey(dateStr, outlet), {
      expectedKsh: computed.expectedKsh,
      depositedKsh: computed.depositedKsh,
      expensesKsh: computed.expensesKsh,
      cashAtTill: computed.projectedTill,
      varianceKsh: computed.varianceKsh,
    });

    // Persist closing/waste to server (non-blocking)
    try {
      await postJSON("/api/attendant/closing", { outlet, date: dateStr, closingMap, wasteMap });
    } catch {}

    // snapshot for next period
    const openingSnapshot: Record<string, number> = {};
    (openingRowsRaw || []).forEach(r => { openingSnapshot[r.itemKey] = (openingSnapshot[r.itemKey] || 0) + Number(r.qty || 0); });

    const pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }> = {};
    (Object.keys(catalog) as ItemKey[]).forEach(k => {
      const p = catalog[k];
      pricebookSnapshot[k] = { sellPrice: Number(p.sellPrice || 0), active: !!p.active };
    });

    try { await postJSON("/api/period/start", { outlet, openingSnapshot, pricebookSnapshot }); }
    catch {}

    setSubmitted(true);
    setTab("summary"); // go straight to Summary tab
    await refreshPeriodAndHeader(outlet);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitDeposits = async () => {
    if (!outlet) return;
    writeJSON(depositsKey(dateStr, outlet), deposits.filter(d => toNum(d.amount) > 0 || (d.code || "").trim() !== ""));
    try {
      await postJSON("/api/deposits", {
        outlet,
        entries: deposits.map(d => ({
          code: (d.code || "").trim() || undefined,
          amount: typeof d.amount === "number" ? d.amount : undefined,
          note: d.note || "",
          rawMessage: (d.note || "").match(/M-?Pesa|Ksh|KES|Confirmed/i) ? d.note : undefined,
        })),
      });
    } catch {}
    await refreshPeriodAndHeader(outlet);
  };

  const submitExpenses = async () => {
    if (!outlet) return;
    writeJSON(expensesKey(dateStr, outlet), expenses.filter(e => (e.name || "").trim() !== "" && toNum(e.amount) > 0)
      .map(e => ({ name: e.name.trim(), amount: toNum(e.amount) })));
    try {
      await postJSON("/api/expenses", {
        outlet,
        items: expenses.filter(e => (e.name || "").trim() !== "" && toNum(e.amount) > 0)
          .map(e => ({ name: e.name.trim(), amount: toNum(e.amount) })),
      });
    } catch {}
    await refreshPeriodAndHeader(outlet);
  };

  async function refreshPeriodAndHeader(outletName: string) {
    try {
      const pa = await getJSON<{ ok: boolean; active: { periodStartAt: string } | null }>(`/api/period/active?outlet=${encodeURIComponent(outletName)}`);
      setPeriodStartAt(pa?.active?.periodStartAt ?? null);
    } catch { setPeriodStartAt(null); }

    try {
      const h = await getJSON<{ ok: boolean; totals: { todayTillSales: number; verifiedDeposits: number; netTill: number; expenses: number; weightSales: number; todayTotalSales: number; amountToDeposit: number } }>(
        `/api/metrics/header?outlet=${encodeURIComponent(outletName)}`
      );
      setKpi({
        weightSales: h.totals.weightSales,
        expenses: h.totals.expenses,
        todayTotalSales: h.totals.todayTotalSales,
        tillSalesNet: h.totals.netTill,
        tillSalesGross: h.totals.todayTillSales,
        verifiedDeposits: h.totals.verifiedDeposits,
        amountToDeposit: h.totals.amountToDeposit,
      });
    } catch {
      const todayTotal = computed.expectedKsh - computed.expensesKsh;
      setKpi({
        weightSales: computed.expectedKsh,
        expenses: computed.expensesKsh,
        todayTotalSales: todayTotal,
        tillSalesNet: 0,
        tillSalesGross: 0,
        verifiedDeposits: 0,
        amountToDeposit: todayTotal,
      });
    }
  }

  async function refreshTill(outletName: string) {
    try {
      const res = await getJSON<{ ok: boolean; total: number; rows: TillPaymentRow[] }>(`/api/payments/till?outlet=${encodeURIComponent(outletName)}`);
      setTillRows(res.rows || []);
      setTillTotal(res.total || 0);
    } catch {
      setTillRows([]); setTillTotal(0);
    }
  }

  /** ===== Logout ===== */
  const logout = () => {
    try { sessionStorage.removeItem("attendant_code"); } catch {}
    window.location.href = "/attendant";
  };

  /** ===== Guard ===== */
  useEffect(() => {
    if (outlet === null) {
      const t = setTimeout(() => {
        if (outlet === null) window.location.href = "/attendant";
      }, 600);
      return () => clearTimeout(t);
    }
  }, [outlet]);

  if (!outlet) {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Attendant Dashboard</h1>
        <p className="text-sm text-gray-600 mt-2">
          Resolving your outlet from the code… If it doesn’t redirect, go back to{" "}
          <a className="underline" href="/attendant">Attendant Login</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Attendant Dashboard</h1>
          <p className="text-sm text-gray-600">
            Outlet: <span className="font-medium">{outlet}</span>
            {periodStartAt ? (
              <span className="ml-2 inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-green-50 border-green-200 text-green-700">
                Active period since {new Date(periodStartAt).toLocaleTimeString()}
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-yellow-50 border-yellow-200 text-yellow-700">
                Awaiting Stock Submit to start new period
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl p-2 text-sm opacity-80"
            type="date"
            value={dateStr}
            disabled   // <-- locked to today
          />
          <button
            onClick={logout}
            className="px-3 py-2 rounded-xl border text-sm"
            title="Logout"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mb-4 flex flex-wrap gap-2">
        <TabBtn active={tab==="stock"} onClick={()=>setTab("stock")}>Stock</TabBtn>
        <TabBtn active={tab==="supply"} onClick={()=>setTab("supply")}>Supply</TabBtn>
        <TabBtn active={tab==="deposits"} onClick={()=>setTab("deposits")}>Deposits</TabBtn>
        <TabBtn active={tab==="expenses"} onClick={()=>setTab("expenses")}>Expenses</TabBtn>
        <TabBtn active={tab==="till"} onClick={()=>setTab("till")}>Till Payments</TabBtn>
        <TabBtn active={tab==="summary"} onClick={()=>setTab("summary")}>Summary</TabBtn>
      </nav>

      {/* ===== STOCK ===== */}
      {tab === "stock" && (
        <>
          <section className="rounded-2xl border p-4 shadow-sm mb-4">
            <h2 className="font-semibold mb-2">Closing & Waste — {dateStr}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Item</th>
                    <th>Opening</th>
                    <th>Closing</th>
                    <th>Waste</th>
                    <th>Sold</th>
                    <th>Expected (Ksh)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td className="py-2 text-gray-500" colSpan={6}>No opening stock found from Supplier for this outlet/day.</td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.key} className="border-b">
                      <td className="py-2">{r.name}</td>
                      <td>{fmt(r.opening)} {r.unit}</td>
                      <td>
                        <input
                          className="border rounded-xl p-2 w-28"
                          type="number"
                          min={0}
                          step={r.unit === "kg" ? 0.01 : 1}
                          value={r.closing}
                          onChange={(e)=>setClosing(r.key, e.target.value===""?"":Number(e.target.value))}
                          placeholder={`0 ${r.unit}`}
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {toNum(r.waste) > 0 ? (
                            <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs">
                              Waste: {fmt(toNum(r.waste))} {r.unit}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">–</span>
                          )}
                          <button className="text-xs border rounded-xl px-2 py-1"
                            onClick={()=>{
                              const v = askWaste(r.unit, r.waste);
                              if (v !== null) setWaste(r.key, v);
                            }}
                          >
                            {toNum(r.waste) > 0 ? "Edit" : "+ Add Waste"}
                          </button>
                          {toNum(r.waste) > 0 && (
                            <button className="text-xs border rounded-xl px-2 py-1" onClick={()=>setWaste(r.key, "")}>Clear</button>
                          )}
                        </div>
                      </td>
                      <td className="font-medium">
                        {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)))} {r.unit}
                      </td>
                      <td className="font-medium">
                        Ksh {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)) * (catalog[r.key]?.sellPrice ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="py-2 font-semibold" colSpan={5}>Total Expected</td>
                    <td className="font-semibold">Ksh {fmt(computed.expectedKsh)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Submit button after stock table */}
          <div className="mb-8">
            <button onClick={submitStock} className="px-4 py-2 rounded-2xl bg-black text-white">
              Submit & Start New Period
            </button>
            {submitted && (
              <span className="ml-3 text-green-700 text-sm align-middle">Saved. New trading period started.</span>
            )}
          </div>
        </>
      )}

      {/* ===== SUPPLY ===== */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Supply (Opening Stock) — {dateStr}</h2>
            <span className="text-xs text-gray-600">Read-only • Disputes go to Supervisor</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(openingRowsRaw.filter(r => !!catalog[r.itemKey])).length === 0 && (
                  <tr><td className="py-3 text-gray-500" colSpan={4}>
                    No opening stock captured by Supplier for this date/outlet.
                  </td></tr>
                )}
                {openingRowsRaw.filter(r => !!catalog[r.itemKey]).map((r, i) => (
                  <tr key={`${r.itemKey}-${i}`} className="border-b">
                    <td className="py-2">{catalog[r.itemKey]?.name ?? r.itemKey.toUpperCase()}</td>
                    <td>{fmt(r.qty)}</td>
                    <td>{catalog[r.itemKey]?.unit ?? "kg"}</td>
                    <td>
                      <button className="text-xs border rounded-lg px-2 py-1" onClick={()=>{
                        const reason = window.prompt(`Raise a dispute for ${catalog[r.itemKey]?.name ?? r.itemKey.toUpperCase()} (qty ${r.qty}). Describe the issue:`, "");
                        if (!reason) return;
                        alert("Dispute submitted to Supervisor.");
                      }}>
                        Raise Dispute
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ===== DEPOSITS ===== */}
      {tab === "deposits" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deposits (M-Pesa)</h3>
            <button className="border rounded-xl px-3 py-1 text-xs" onClick={addDeposit}>+ Add deposit</button>
          </div>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Code</th>
                  <th>Amount (Ksh)</th>
                  <th>Status</th>
                  <th>Note / Paste SMS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={5}>No deposits.</td></tr>}
                {deposits.map((d)=>(
                  <tr key={d.id} className="border-b">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-40" placeholder="M-Pesa code" value={d.code}
                        onChange={(e)=>upDeposit(d.id,{code:e.target.value})}/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-28" type="number" min={0} step={1}
                        placeholder="Ksh" value={d.amount}
                        onChange={(e)=>upDeposit(d.id,{amount:e.target.value===""?"":Number(e.target.value)})}/>
                    </td>
                    <td><StatusPill status={d.status || "PENDING"} /></td>
                    <td>
                      <input className="border rounded-xl p-2 w-60" placeholder="optional note or paste full SMS"
                        value={d.note || ""} onChange={(e)=>upDeposit(d.id,{note:e.target.value})}/>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmDeposit(d.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td className="font-semibold">Ksh {fmt(deposits.reduce((a,d)=>a+toNum(d.amount),0))}</td>
                  <td colSpan={3} className="text-right">
                    <button className="px-3 py-2 rounded-xl border" onClick={submitDeposits}>Submit Deposits</button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ===== EXPENSES ===== */}
      {tab === "expenses" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Expenses</h3>
            <button className="border rounded-xl px-3 py-1 text-xs" onClick={addExpense}>+ Add expense</button>
          </div>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b"><th className="py-2">Name</th><th>Amount (Ksh)</th><th></th></tr>
              </thead>
              <tbody>
                {expenses.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={3}>No expenses.</td></tr>}
                {expenses.map((e)=>(
                  <tr key={e.id} className="border-b">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-44" placeholder="e.g. Sharpen"
                        value={e.name} onChange={(ev)=>upExpense(e.id,{name:ev.target.value})}/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-32" type="number" min={0} step={1} placeholder="Ksh"
                        value={e.amount} onChange={(ev)=>upExpense(e.id,{amount:ev.target.value===""?"":Number(ev.target.value)})}/>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmExpense(e.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td className="font-semibold">Ksh {fmt(expenses.reduce((a,e)=>a+toNum(e.amount),0))}</td>
                  <td className="text-right">
                    <button className="px-3 py-2 rounded-xl border" onClick={submitExpenses}>Submit Expenses</button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ===== TILL PAYMENTS ===== */}
      {tab === "till" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Till Payments (Active Period)</h3>
            <button className="text-xs border rounded-xl px-3 py-1" onClick={()=>outlet && refreshTill(outlet)}>↻ Refresh</button>
          </div>
          <div className="text-sm text-gray-600 mb-2">
            Total Till Payments: <span className="font-semibold">Ksh {fmt(tillTotal)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Time</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Receipt</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {tillRows.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={5}>No payments yet in this period.</td></tr>}
                {tillRows.map((r, i)=>(
                  <tr key={i} className="border-b">
                    <td className="py-2">{new Date(r.time).toLocaleTimeString()}</td>
                    <td>{r.customer || "—"}</td>
                    <td>Ksh {fmt(r.amount)}</td>
                    <td>{r.code || "—"}</td>
                    <td>{r.ref || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ===== SUMMARY ===== */}
      {tab === "summary" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Summary (Active Period)</h3>
            <button
              className="border rounded-xl px-3 py-1 text-xs"
              onClick={() => window.print()}
            >
              Download PDF
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <CardKPI label="Weight Sales (Ksh)" value={`Ksh ${fmt(kpi.weightSales)}`} />
            <CardKPI label="Expenses (Ksh)" value={`Ksh ${fmt(kpi.expenses)}`} />
            <CardKPI label="Today Total Sales (Ksh)" value={`Ksh ${fmt(kpi.todayTotalSales)}`} />
            <CardKPI label="Till Sales (Gross)" value={`Ksh ${fmt(kpi.tillSalesGross)}`} />
            <CardKPI label="Verified Deposits" value={`Ksh ${fmt(kpi.verifiedDeposits)}`} />
            <CardKPI label="Till Sales (Net)" value={`Ksh ${fmt(kpi.tillSalesNet)}`} />
          </div>

          {/* ✅ Highlight red ONLY when > 0 */}
          <div className="mt-4">
            <CardKPI
              label="Amount to Deposit (Ksh)"
              value={`Ksh ${fmt(kpi.amountToDeposit)}`}
              highlightDanger={kpi.amountToDeposit > 0}
            />
          </div>
        </section>
      )}
    </main>
  );
}

/** ===== UI bits ===== */
function CardKPI({
  label,
  value,
  subtitle,
  highlight,
  highlightDanger,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;         // legacy yellow style (kept)
  highlightDanger?: boolean;   // NEW red style when true
}) {
  const base = "rounded-2xl border p-4";
  const yellow = "bg-yellow-50 border-yellow-200";
  const red = "bg-red-50 border-red-300";
  const wrapClass = `${base} ${highlightDanger ? red : highlight ? yellow : ""}`;

  return (
    <div className={wrapClass}>
      <div className={`text-sm ${highlightDanger ? "text-red-700" : "text-gray-500"}`}>{label}</div>
      <div className={`text-xl font-semibold mt-1 ${highlightDanger ? "text-red-700" : ""}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl border text-sm ${active ? "bg-black text-white" : ""}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: "VALID"|"PENDING"|"INVALID" }) {
  const m: Record<string, string> = {
    VALID: "bg-green-50 text-green-700 border-green-200",
    PENDING: "bg-yellow-50 text-yellow-700 border-yellow-200",
    INVALID: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center rounded-xl border px-2 py-1 ${m[status]} text-xs`}>
      {status === "VALID" ? "Valid" : status === "PENDING" ? "Pending" : "Invalid"}
    </span>
  );
}

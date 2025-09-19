"use client";

import React, { useEffect, useMemo, useState } from "react";

/** ========= Types ========= */
type Unit = "kg" | "pcs";
type ItemKey =
  | "beef" | "goat" | "liver" | "kuku" | "matumbo"
  | "potatoes" | "samosas" | "mutura";

type Row = { key: ItemKey; name: string; unit: Unit; opening: number; closing: number | ""; waste: number | "" };
type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";
type Deposit = { id: string; code: string; amount: number | ""; note?: string };
type AdminProduct = { key: ItemKey; name: string; unit: Unit; sellPrice: number; active: boolean; };
type AdminOutlet = { name: string; code: string; active: boolean };

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

/** ========= NEW (for disputes to supervisor) ========= */
const AMEND_REQUESTS_KEY = "amend_requests";

/** ========= NEW (scope mapping: attendant_code -> outlet + products) ========= */
const SCOPE_KEY = "attendant_scope"; // { [code: string]: { outlet: Outlet; productKeys: ItemKey[] } }

/** ========= NEW (per-outlet price override) ========= */
const PRICEBOOK_KEY = "admin_pricebook"; // { [outletName]: { [productKey]: { sellPrice:number, active:boolean } } }

/** ========= NEW (waste review status written by Supervisor) ========= */
const wasteReviewKey = (date: string, outlet: string) => `supervisor_waste_review_${date}_${outlet}`;

/** ========= Helpers (unchanged computations) ========= */
function toNum(v: number | "" | undefined) { return typeof v === "number" ? v : v ? Number(v) : 0; }
function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function today() { return new Date().toISOString().split("T")[0]; }
function id() { return Math.random().toString(36).slice(2); }
function readJSON<T>(k: string, fallback: T): T {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function writeJSON(k: string, v: any) { localStorage.setItem(k, JSON.stringify(v)); }

/** ========= Small UI helper for optional waste ========= */
function askWaste(unit: Unit, current: number | ""): number | null {
  const init = current === "" ? "" : String(current);
  const raw = window.prompt(`Enter waste in ${unit}`, init) ?? "";
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) { alert("Enter a non-negative number"); return null; }
  return n;
}

export default function AttendantDashboard() {
  const [dateStr, setDateStr] = useState(today());
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [catalog, setCatalog] = useState<Record<ItemKey, AdminProduct>>({} as any);

  // Stock rows (built from supplier opening)
  const [rows, setRows] = useState<Row[]>([]);
  // Raw opening rows (for Supply tab)
  const [openingRowsRaw, setOpeningRowsRaw] = useState<Array<{ itemKey: ItemKey; qty: number }>>([]);

  // Deposits / Expenses / Till
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [expenses, setExpenses] = useState<Array<{ id: string; name: string; amount: number | "" }>>([]);
  const [countedTill, setCountedTill] = useState<number | "">("");

  // Submit flag
  const [submitted, setSubmitted] = useState(false);

  // Tabs (as requested)
  const [tab, setTab] = useState<"stock" | "supply" | "deposits" | "expenses">("stock");

  // Optional items toggle (unchanged)
  const OPTIONALS: ItemKey[] = ["potatoes", "samosas", "mutura"];

  // Waste review map for current date/outlet (set by Supervisor)
  const [wasteReview, setWasteReview] = useState<Record<
    string,
    { status: "approved" | "rejected"; reason?: string; reviewer?: string; reviewedAt?: string }
  >>({});

  /** ===== Load outlet from login code & products (unchanged) ===== */
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
      const map = arr.filter(p => p.active).reduce((acc, p) => {
        acc[p.key as ItemKey] = p; return acc;
      }, {} as Record<ItemKey, AdminProduct>);
      setCatalog(map);
    }
  }, []);

  /** ===== Enforce per-attendant scope WITHOUT changing login ===== */
  useEffect(() => {
    const code = sessionStorage.getItem("attendant_code") || "";
    if (!code) return;
    try {
      const raw = localStorage.getItem(SCOPE_KEY);
      if (!raw) return; // no scopes yet → keep existing behavior
      const map = JSON.parse(raw) as Record<string, { outlet: Outlet; productKeys: ItemKey[] }>;
      const scope = map[code];
      if (!scope) return;

      // Force outlet to scoped outlet
      setOutlet(scope.outlet as Outlet);

      // Restrict catalog to scoped products (no infinite loop)
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

  /** ===== NEW: Overlay per-outlet pricebook (price & enabled) ===== */
  useEffect(() => {
    if (!outlet) return;
    try {
      const raw = localStorage.getItem(PRICEBOOK_KEY);
      if (!raw) return;
      const all = JSON.parse(raw) as Record<string, Record<ItemKey, { sellPrice: number; active: boolean }>>;
      const pbForOutlet = all[outlet];
      if (!pbForOutlet) return;

      setCatalog(prev => {
        let changed = false;
        const next: Record<ItemKey, AdminProduct> = { ...prev };
        (Object.keys(prev) as ItemKey[]).forEach(k => {
          const row = pbForOutlet[k];
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

  /** ===== Load opening + previous entries when outlet/date changes ===== */
  useEffect(() => {
    if (!outlet) return;
    try {
      const openingRows = JSON.parse(localStorage.getItem(supplierOpeningKey(dateStr, outlet)) || "[]") as Array<{ itemKey: ItemKey; qty: number }>;
      setOpeningRowsRaw(openingRows || []);

      const byItem: Record<ItemKey, number> = {} as any;
      (openingRows || []).forEach(r => { byItem[r.itemKey] = (byItem[r.itemKey] || 0) + Number(r.qty || 0); });
      const built: Row[] = (Object.keys(byItem) as ItemKey[])
        .filter(k => !!catalog[k]) // enforce scope by catalog (and pricebook enabled)
        .map(k => {
          const key = k as ItemKey; const prod = catalog[key];
          return { key, name: prod?.name || key.toUpperCase(), unit: prod?.unit || "kg", opening: byItem[key] || 0, closing: "", waste: "" };
        });
      setRows(built);
      setSubmitted(false);
    } catch {}

    // deposits
    try {
      const depListRaw = localStorage.getItem(depositsKey(dateStr, outlet));
      if (depListRaw) {
        const arr = JSON.parse(depListRaw) as Deposit[];
        setDeposits(arr.map(d => ({ ...d, id: d.id || id() })));
      } else {
        // migrate legacy total number (keep backward compat)
        const depRaw = localStorage.getItem(depositKey(dateStr, outlet));
        if (depRaw) {
          const total = Number(JSON.parse(depRaw) || 0);
          setDeposits(total > 0 ? [{ id: id(), code: "", amount: total, note: "" }] : []);
        } else setDeposits([]);
      }
    } catch { setDeposits([]); }

    // expenses
    try {
      const exRaw = localStorage.getItem(expensesKey(dateStr, outlet));
      if (exRaw) {
        const ex = JSON.parse(exRaw) as Array<{ name: string; amount: number }>;
        setExpenses(ex.map(e => ({ id: id(), name: e.name, amount: e.amount })));
      } else setExpenses([]);
    } catch { setExpenses([]); }

    // till
    try {
      const t = localStorage.getItem(countedTillKey(dateStr, outlet));
      setCountedTill(t ? Number(t) : "");
    } catch { setCountedTill(""); }

    // waste review status (set by Supervisor dashboard)
    try {
      const wrRaw = localStorage.getItem(wasteReviewKey(dateStr, outlet));
      setWasteReview(wrRaw ? JSON.parse(wrRaw) : {});
    } catch { setWasteReview({}); }
  }, [dateStr, outlet, catalog]);

  /** ===== Computations (unchanged) ===== */
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

  /** ===== Mutations (unchanged logic) ===== */
  const setClosing = (key: ItemKey, v: number | "") =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, closing: v } : r));
  const setWaste   = (key: ItemKey, v: number | "") =>
    setRows(prev => prev.map(r => r.key === key ? { ...r, waste: v } : r));

  // Deposits
  const addDeposit = () => setDeposits(prev => [...prev, { id: id(), code: "", amount: "", note: "" }]);
  const rmDeposit  = (did: string) => setDeposits(prev => prev.filter(d => d.id !== did));
  const upDeposit  = (did: string, patch: Partial<Deposit>) =>
    setDeposits(prev => prev.map(d => d.id === did ? { ...d, ...patch } : d));

  // Expenses
  const addExpense = () => setExpenses(prev => [...prev, { id: id(), name: "", amount: "" }]);
  const rmExpense  = (eid: string) => setExpenses(prev => prev.filter(e => e.id !== eid));
  const upExpense  = (eid: string, patch: Partial<{name: string; amount: number | ""}>) =>
    setExpenses(prev => prev.map(e => e.id === eid ? { ...e, ...patch } : e));

  // Dispute
  const raiseDispute = (row: { itemKey: ItemKey; qty: number }) => {
    const attendantCode = sessionStorage.getItem("attendant_code") || "";
    const reason = window.prompt(
      `Raise a dispute for ${catalog[row.itemKey]?.name ?? row.itemKey.toUpperCase()} (qty ${row.qty}). Describe the issue:`,
      ""
    );
    if (!reason) return;
    const req = {
      id: id(),
      date: dateStr,
      outlet: outlet!,
      requestedBy: attendantCode,
      type: "supply" as const,
      itemKey: row.itemKey,
      qty: row.qty,
      description: reason,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
    };
    const list = readJSON<any[]>(AMEND_REQUESTS_KEY, []);
    writeJSON(AMEND_REQUESTS_KEY, [req, ...list]);
    alert("Dispute submitted to Supervisor.");
  };

  /** ===== Submit (unchanged storage) ===== */
  const submit = () => {
    if (!outlet) return;
    const closingMap: Record<string, number> = {};
    const wasteMap: Record<string, number>   = {};
    rows.forEach(r => { closingMap[r.key] = toNum(r.closing); wasteMap[r.key] = toNum(r.waste); });
    localStorage.setItem(attClosingKey(dateStr, outlet), JSON.stringify(closingMap));
    localStorage.setItem(attWasteKey(dateStr, outlet), JSON.stringify(wasteMap));
    localStorage.setItem(depositsKey(dateStr, outlet), JSON.stringify(
      deposits.filter(d => toNum(d.amount) > 0 || (d.code || "").trim() !== "")
    ));
    localStorage.setItem(expensesKey(dateStr, outlet), JSON.stringify(
      expenses.filter(e => (e.name || "").trim() !== "" && toNum(e.amount) > 0)
        .map(e => ({ name: e.name.trim(), amount: toNum(e.amount) }))
    ));
    localStorage.setItem(countedTillKey(dateStr, outlet), JSON.stringify(toNum(countedTill)));
    localStorage.setItem(summaryKey(dateStr, outlet), JSON.stringify({
      expectedKsh: computed.expectedKsh,
      depositedKsh: computed.depositedKsh,
      expensesKsh: computed.expensesKsh,
      cashAtTill: computed.projectedTill,
      varianceKsh: computed.varianceKsh,
    }));
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Attendant Dashboard</h1>
          <p className="text-sm text-gray-600">Outlet: <span className="font-medium">{outlet}</span></p>
        </div>
        <input className="border rounded-xl p-2 text-sm" type="date" value={dateStr} onChange={(e)=>setDateStr(e.target.value)} />
      </header>

      {/* Tabs */}
      <nav className="mb-4 flex gap-2">
        <TabBtn active={tab==="stock"} onClick={()=>setTab("stock")}>Stock</TabBtn>
        <TabBtn active={tab==="supply"} onClick={()=>setTab("supply")}>Supply</TabBtn>
        <TabBtn active={tab==="deposits"} onClick={()=>setTab("deposits")}>Deposits</TabBtn>
        <TabBtn active={tab==="expenses"} onClick={()=>setTab("expenses")}>Expenses</TabBtn>
      </nav>

      {/* ===== STOCK ===== */}
      {tab === "stock" && (
        <>
          <section className="rounded-2xl border p-4 shadow-sm mb-6">
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
                  {rows.map(r=>
                    (
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
                        {toNum(r.waste) > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs">
                              Waste: {fmt(toNum(r.waste))} {r.unit}
                            </span>
                            {/* NEW: show supervisor waste review status (if any) */}
                            {(() => {
                              const ws = wasteReview[r.key];
                              if (ws?.status === "rejected") {
                                return (
                                  <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs bg-red-50 text-red-700 border-red-200">
                                    Rejected
                                  </span>
                                );
                              }
                              if (ws?.status === "approved") {
                                return (
                                  <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs bg-green-50 text-green-700 border-green-200">
                                    Approved
                                  </span>
                                );
                              }
                              return (
                                <span className="inline-flex items-center rounded-xl border px-2 py-1 text-xs text-gray-600">
                                  Pending review
                                </span>
                              );
                            })()}
                            <button
                              className="text-xs border rounded-xl px-2 py-1"
                              onClick={()=>{
                                const v = askWaste(r.unit, r.waste);
                                if (v !== null) setWaste(r.key, v);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="text-xs border rounded-xl px-2 py-1"
                              onClick={()=>setWaste(r.key, "")}
                            >
                              Clear
                            </button>
                          </div>
                        ) : (
                          <button
                            className="text-xs border rounded-xl px-3 py-2"
                            onClick={()=>{
                              const v = askWaste(r.unit, "");
                              if (v !== null) setWaste(r.key, v);
                            }}
                          >
                            + Add Waste
                          </button>
                        )}
                      </td>
                      <td className="font-medium">
                        {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)))} {r.unit}
                      </td>
                      <td className="font-medium">
                        Ksh {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)) * sellPrice(r.key))}
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

          {/* Quick Totals + Till & Submit in stock tab */}
          <section className="rounded-2xl border p-4 mb-6">
            <h3 className="font-semibold mb-2">Today’s Totals</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <CardKPI label="Expected (Ksh)" value={`Ksh ${fmt(computed.expectedKsh)}`} />
              <CardKPI label="Deposits (Ksh)" value={`Ksh ${fmt(computed.depositedKsh)}`} />
              <CardKPI label="Expenses (Ksh)" value={`Ksh ${fmt(computed.expensesKsh)}`} />
              <CardKPI label="Projected Till (Ksh)" value={`Ksh ${fmt(computed.projectedTill)}`} />
              <CardKPI label="Variance (Ksh)" value={`Ksh ${fmt(computed.varianceKsh)}`} />
            </div>

            <div className="mt-4">
              <label className="text-sm text-gray-600">Till Count (Actual)</label>
              <input
                className="border rounded-xl p-2 w-full max-w-xs mt-1"
                type="number"
                min={0}
                step={1}
                placeholder="Enter counted cash in till (Ksh)"
                value={countedTill}
                onChange={(e)=>setCountedTill(e.target.value===""?"":Number(e.target.value))}
              />
            </div>

            <div className="mt-4">
              <button onClick={submit} className="px-4 py-2 rounded-2xl bg-black text-white">Submit</button>
            </div>

            {submitted && (
              <p className="text-green-700 mt-2 text-sm">Final summary saved for Admin Reports & Supervisor review.</p>
            )}
          </section>
        </>
      )}

      {/* ===== SUPPLY (read-only + dispute) ===== */}
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
                      <button className="text-xs border rounded-lg px-2 py-1" onClick={() => raiseDispute(r)}>
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
            <h3 className="font-semibold">Deposits (MPesa)</h3>
            <button className="border rounded-xl px-3 py-1 text-xs" onClick={addDeposit}>+ Add deposit</button>
          </div>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b"><th className="py-2">Code</th><th>Amount (Ksh)</th><th>Note</th><th></th></tr>
              </thead>
              <tbody>
                {deposits.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={4}>No deposits.</td></tr>}
                {deposits.map((d)=>(
                  <tr key={d.id} className="border-b">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-40" placeholder="MPesa code" value={d.code} onChange={(e)=>upDeposit(d.id,{code:e.target.value})}/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-28" type="number" min={0} step={1}
                        placeholder="Ksh" value={d.amount}
                        onChange={(e)=>upDeposit(d.id,{amount:e.target.value===""?"":Number(e.target.value)})}/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-40" placeholder="optional note" value={d.note || ""}
                        onChange={(e)=>upDeposit(d.id,{note:e.target.value})}/>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmDeposit(d.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td className="font-semibold">Ksh {fmt(deposits.reduce((a,d)=>a+toNum(d.amount),0))}</td>
                  <td colSpan={2}></td>
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
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

/** ===== UI bits ===== */
function CardKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
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

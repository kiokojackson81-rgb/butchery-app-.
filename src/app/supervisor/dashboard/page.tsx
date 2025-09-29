// src/app/supervisor/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { hydrateLocalStorageFromDB } from "@/lib/settingsBridge";
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON } from "@/utils/safeStorage";

/* ================= Existing Review Keys (unchanged) ================= */
const WASTE_KEY     = "attendant_waste_reviews";    // waste entries needing review
const EXPENSES_KEY  = "attendant_expenses_reviews"; // expenses needing review
const EXCESS_KEY    = "excess_adjustments_reviews"; // excess approval requests
const DEFICIT_KEY   = "deficit_disputes_reviews";   // deficit disputes
const DEPOSITS_KEY  = "attendant_deposits_reviews"; // deposit monitoring

/* ================= Extra keys used only for summary/supply view ================= */
const depositsKey = (date: string, outlet: string) =>
  `attendant_deposits_${date}_${outlet}`;
const expensesDailyKey = (date: string, outlet: string) =>
  `attendant_expenses_${date}_${outlet}`;
const summaryKey = (date: string, outlet: string) =>
  `attendant_summary_${date}_${outlet}`; // { expectedKsh, depositedKsh, expensesKsh, cashAtTill, varianceKsh }
const WASTE_MAP = (date: string, outlet: string) =>
  `attendant_waste_${date}_${outlet}`; // { [itemKey]: qty }

/* ---- Supply (opening) rows (used by attendants) ---- */
const supplierOpeningKey = (date: string, outlet: string) =>
  `supplier_opening_${date}_${outlet}`; // Array<{ itemKey: string; qty: number }>

// Admin outlets (names list)
const ADMIN_OUTLETS_KEY = "admin_outlets";

type AdminOutlet = { id?: string; name: string; code?: string; active: boolean };

type ReviewItem = {
  id: string;
  date: string;
  outlet: string;
  item?: string;
  amount: number;
  note?: string;
  state: "pending" | "approved" | "rejected";
};

type KPIRow = {
  outlet: string;
  expected: number;
  deposits: number;
  expenses: number;
  cashAtTill: number;
  variance: number;
  wasteQty: number;
};

function todayLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}
function readJSON<T>(k: string, fb: T): T { return safeReadJSON<T>(k, fb); }
function fmt(n: number) {
  return (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function SupervisorDashboard() {
  /* ========= Filters ========= */
  const [date, setDate] = useState<string>(todayLocal());
  const [outlets, setOutlets] = useState<AdminOutlet[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>("__ALL__");
  const [refreshTick, setRefreshTick] = useState(0); // bump to re-fetch supply tables

  // Header KPIs + active period (server-first with graceful fallback)
  const [periodStartAt, setPeriodStartAt] = useState<string | null>(null);
  const [serverKpi, setServerKpi] = useState<{
    expected: number; // map from weightSales
    deposits: number; // verifiedDeposits
    expenses: number; // expenses
    cashAtTill: number; // amountToDeposit
    variance: number; // not provided by API; keep 0
  } | null>(null);
  const [kpiOffline, setKpiOffline] = useState(false);

  /* ========= Tabs (added "supply") ========= */
  const [tab, setTab] = useState<
    "waste" | "expenses" | "excess" | "deficit" | "deposits" | "supply"
  >("waste");

  /* ========= Review lists (existing) ========= */
  const [waste, setWaste] = useState<ReviewItem[]>([]);
  const [expenses, setExpenses] = useState<ReviewItem[]>([]);
  const [excess, setExcess] = useState<ReviewItem[]>([]);
  const [deficit, setDeficit] = useState<ReviewItem[]>([]);
  const [deposits, setDeposits] = useState<ReviewItem[]>([]);

  // Load review lists + outlets
  useEffect(() => {
    // Ensure admin settings are hydrated from DB first (thin persistence)
    (async () => { try { await hydrateLocalStorageFromDB(); } catch {} })();
    (async () => {
      try {
        // 1) Sync any local pending items to server (best-effort)
        const allLocal = [
          ...read(WASTE_KEY).map(r => ({ type: "waste",    outlet: r.outlet, date: r.date, payload: r })),
          ...read(EXPENSES_KEY).map(r => ({ type: "expense",  outlet: r.outlet, date: r.date, payload: r })),
          ...read(EXCESS_KEY).map(r => ({ type: "excess",   outlet: r.outlet, date: r.date, payload: r })),
          ...read(DEFICIT_KEY).map(r => ({ type: "deficit",  outlet: r.outlet, date: r.date, payload: r })),
          ...read(DEPOSITS_KEY).map(r => ({ type: "deposit", outlet: r.outlet, date: r.date, payload: r })),
        ].filter(x => (x?.payload?.state || "pending") === "pending");
        if (allLocal.length) {
          try {
            await fetch("/api/supervisor/reviews", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({ items: allLocal })
            });
          } catch {}
        }

        // 2) Fetch server lists (all, keep UI behavior unchanged)
        const res = await fetch("/api/supervisor/reviews", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json().catch(()=>null as any);
          const items: any[] = j?.items || [];
          // Partition by type; keep shape compatible with existing UI
          const toView = (t: string) => items.filter(i => i.type === t).map(i => ({
            id: i.id,
            date: new Date(i.date).toISOString().slice(0,10),
            outlet: i.outlet,
            item: i.payload?.item || i.payload?.itemKey || i.payload?.item_name,
            amount: Number(i.payload?.amount ?? i.payload?.qty ?? 0),
            note: i.payload?.note || i.payload?.description || "",
            state: (i.status || "pending") as "pending"|"approved"|"rejected",
          }));
          const w = toView("waste");
          const exps = toView("expense");
          const exs = toView("excess");
          const defs = toView("deficit");
          const deps = toView("deposit");
          // write-through to local so Approve/Reject local mirror stays in sync
          save(WASTE_KEY, w);
          save(EXPENSES_KEY, exps);
          save(EXCESS_KEY, exs);
          save(DEFICIT_KEY, defs);
          save(DEPOSITS_KEY, deps);
          setWaste(w);
          setExpenses(exps);
          setExcess(exs);
          setDeficit(defs);
          setDeposits(deps);
        } else {
          // Fallback to local if server fails
          setWaste(read(WASTE_KEY));
          setExpenses(read(EXPENSES_KEY));
          setExcess(read(EXCESS_KEY));
          setDeficit(read(DEFICIT_KEY));
          setDeposits(read(DEPOSITS_KEY));
        }
      } catch {
        setWaste(read(WASTE_KEY));
        setExpenses(read(EXPENSES_KEY));
        setExcess(read(EXCESS_KEY));
        setDeficit(read(DEFICIT_KEY));
        setDeposits(read(DEPOSITS_KEY));
      }

      const outs = readJSON<AdminOutlet[]>(ADMIN_OUTLETS_KEY, []);
      setOutlets((outs || []).filter(o => o?.name));
    })();
  }, []);

  // Fetch active period + KPIs for a single outlet (server-first)
  useEffect(() => {
    if (!selectedOutlet || selectedOutlet === "__ALL__") {
      setPeriodStartAt(null);
      setServerKpi(null);
      setKpiOffline(false);
      return;
    }
    (async () => {
      try {
        const pa = await fetch(`/api/period/active?outlet=${encodeURIComponent(selectedOutlet)}`, { cache: "no-store" });
        if (pa.ok) {
          const j = await pa.json();
          setPeriodStartAt(j?.active?.periodStartAt ?? null);
        } else {
          setPeriodStartAt(null);
        }
      } catch {
        setPeriodStartAt(null);
      }
      try {
        const r = await fetch(`/api/metrics/header?outlet=${encodeURIComponent(selectedOutlet)}`, { cache: "no-store" });
        if (r.ok) {
          const h = await r.json();
          const t = h?.totals || {};
          setServerKpi({
            expected: Number(t.weightSales || 0),
            deposits: Number(t.verifiedDeposits || 0),
            expenses: Number(t.expenses || 0),
            cashAtTill: Number(t.amountToDeposit || 0),
            variance: 0,
          });
          setKpiOffline(false);
        } else {
          setServerKpi(null);
          setKpiOffline(true);
        }
      } catch {
        setServerKpi(null);
        setKpiOffline(true);
      }
    })();
  }, [selectedOutlet]);

  const updateState = (
    key: string,
    id: string,
    state: "approved" | "rejected"
  ) => {
    // 1) Server first (best-effort)
    (async () => {
      try {
        const url = new URL(`/api/supervisor/reviews/${encodeURIComponent(id)}/${state}`, window.location.origin);
        await fetch(url.toString(), { method: "POST", cache: "no-store" });
      } catch {}
    })();

    // 2) Mirror change locally to preserve current UX
    const list = read(key).map((r: ReviewItem) => (r.id === id ? { ...r, state } : r));
    save(key, list);
    if (key === WASTE_KEY) setWaste(list);
    if (key === EXPENSES_KEY) setExpenses(list);
    if (key === EXCESS_KEY) setExcess(list);
    if (key === DEFICIT_KEY) setDeficit(list);
    if (key === DEPOSITS_KEY) setDeposits(list);
  };

  /* ========= KPI Summary (date + outlet/all) ========= */
  const outletNames = useMemo(
    () =>
      selectedOutlet === "__ALL__"
        ? outlets.map((o) => o.name)
        : [selectedOutlet],
    [selectedOutlet, outlets]
  );

  const kpis: KPIRow[] = useMemo(() => {
    const rows: KPIRow[] = [];
    outletNames.forEach((outletName) => {
      if (!outletName) return;

      // Preferred summary saved by attendants
      const summary = readJSON<{
        expectedKsh: number;
        depositedKsh: number;
        expensesKsh: number;
        cashAtTill: number;
        varianceKsh: number;
      } | null>(summaryKey(date, outletName), null);

      // Fallbacks
      const deps = readJSON<Array<{ amount: number }>>(
        depositsKey(date, outletName),
        []
      );
      const exps = readJSON<Array<{ amount: number }>>(
        expensesDailyKey(date, outletName),
        []
      );
      const totalDeposits = deps.reduce((a, d) => a + (Number(d.amount) || 0), 0);
      const totalExpenses = exps.reduce((a, e) => a + (Number(e.amount) || 0), 0);

      const wasteMap = readJSON<Record<string, number>>(
        WASTE_MAP(date, outletName),
        {}
      );
      const wasteQty = Object.values(wasteMap).reduce(
        (a, n) => a + (Number(n) || 0),
        0
      );

      rows.push({
        outlet: outletName,
        expected: summary?.expectedKsh ?? 0,
        deposits: summary?.depositedKsh ?? totalDeposits,
        expenses: summary?.expensesKsh ?? totalExpenses,
        cashAtTill:
          summary?.cashAtTill ??
          Math.max(
            0,
            (summary?.expectedKsh ?? 0) -
              (summary?.depositedKsh ?? totalDeposits) -
              (summary?.expensesKsh ?? totalExpenses)
          ),
        variance: summary?.varianceKsh ?? 0,
        wasteQty,
      });
    });
    return rows;
  }, [date, outletNames]);

  const agg = useMemo(
    () =>
      kpis.reduce(
        (a, r) => {
          a.expected += r.expected;
          a.deposits += r.deposits;
          a.expenses += r.expenses;
          a.cashAtTill += r.cashAtTill;
          a.variance += r.variance;
          a.wasteQty += r.wasteQty;
          return a;
        },
        {
          expected: 0,
          deposits: 0,
          expenses: 0,
          cashAtTill: 0,
          variance: 0,
          wasteQty: 0,
        }
      ),
    [kpis]
  );

  /* ========= Actions ========= */
  const downloadPDF = () => { try { window.print(); } catch {} };
  const logout = () => {
    try {
      sessionStorage.removeItem("supervisor_code");
      sessionStorage.removeItem("supervisor_name");
    } catch {}
    window.location.href = "/supervisor";
  };

  return (
    <main className="mobile-container sticky-safe p-6 max-w-7xl mx-auto">
      {/* Header / Filters */}
  <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold">Supervisor Dashboard</h1>
          <p className="text-sm text-gray-600">
            Review waste/expenses/excess/deficit/deposits & monitor sales and deposits by outlet.
          </p>
          {selectedOutlet !== "__ALL__" && (
            <p className="mt-1 text-xs">
              {periodStartAt ? (
                <span className="inline-flex items-center rounded-xl border px-2 py-0.5 bg-green-50 border-green-200 text-green-700">
                  Active period since {new Date(periodStartAt).toLocaleTimeString()}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-xl border px-2 py-0.5 bg-yellow-50 border-yellow-200 text-yellow-700">
                  Period inactive or unavailable
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 mobile-scroll-x">
          <input
            className="input-mobile border rounded-xl p-2 text-sm"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <select
            className="input-mobile border rounded-xl p-2 text-sm"
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
          >
            <option value="__ALL__">All Outlets</option>
            {outlets.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
          <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={downloadPDF}>
            Download PDF
          </button>
          <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* KPI Summary */}
      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-semibold mb-3">
          Summary — {selectedOutlet === "__ALL__" ? "All Outlets" : selectedOutlet} ({date})
        </h2>
        {selectedOutlet !== "__ALL__" && kpiOffline && (
          <div className="text-xs text-yellow-700 mb-2">server unavailable — showing local totals</div>
        )}
        {(() => {
          const vals = selectedOutlet !== "__ALL__" && serverKpi
            ? serverKpi
            : agg;
          return (
            <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">
              <KPI label="Expected Sales (Ksh)" value={`Ksh ${fmt(vals.expected)}`} />
              <KPI label="Deposits (Ksh)" value={`Ksh ${fmt(vals.deposits)}`} />
              <KPI label="Expenses (Ksh)" value={`Ksh ${fmt(vals.expenses)}`} />
              <KPI label="Cash at Till (Ksh)" value={`Ksh ${fmt(vals.cashAtTill)}`} />
              <KPI label="Variance (Ksh)" value={`Ksh ${fmt((vals as any).variance || 0)}`} />
            </div>
          );
        })()}
        <div className="grid md:grid-cols-3 gap-3 mt-3">
          <KPI label="Waste (Qty)" value={fmt(agg.wasteQty)} />
        </div>

        {/* Per-outlet breakdown */}
        {selectedOutlet === "__ALL__" && (
          <div className="table-wrap mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Outlet</th>
                  <th>Expected</th>
                  <th>Deposits</th>
                  <th>Expenses</th>
                  <th>Cash @ Till</th>
                  <th>Variance</th>
                  <th>Waste (Qty)</th>
                  <th>Deposited?</th>
                </tr>
              </thead>
              <tbody>
                {kpis.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={8}>
                      No data.
                    </td>
                  </tr>
                ) : (
                  kpis.map((r) => (
                    <tr key={r.outlet} className="border-b">
                      <td className="py-2">{r.outlet}</td>
                      <td>Ksh {fmt(r.expected)}</td>
                      <td>Ksh {fmt(r.deposits)}</td>
                      <td>Ksh {fmt(r.expenses)}</td>
                      <td>Ksh {fmt(r.cashAtTill)}</td>
                      <td>Ksh {fmt(r.variance)}</td>
                      <td>{fmt(r.wasteQty)}</td>
                      <td>{r.deposits > 0 ? "Yes" : "No"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Menu (added Supply View) */}
      <nav className="flex gap-2 mb-4 mobile-scroll-x">
        <TabBtn active={tab === "waste"} onClick={() => setTab("waste")}>
          Waste Review
        </TabBtn>
        <TabBtn active={tab === "expenses"} onClick={() => setTab("expenses")}>
          Expenses Review
        </TabBtn>
        <TabBtn active={tab === "excess"} onClick={() => setTab("excess")}>
          Excess Approvals
        </TabBtn>
        <TabBtn active={tab === "deficit"} onClick={() => setTab("deficit")}>
          Deficit Disputes
        </TabBtn>
        <TabBtn active={tab === "deposits"} onClick={() => setTab("deposits")}>
          Deposits Monitor
        </TabBtn>
        <TabBtn active={tab === "supply"} onClick={() => setTab("supply")}>
          Supply View
        </TabBtn>
      </nav>

      {tab === "waste" && (
        <ReviewTable
          title="Waste Requests"
          data={waste}
          onAction={(id, state) => updateState(WASTE_KEY, id, state)}
        />
      )}
      {tab === "expenses" && (
        <ReviewTable
          title="Expense Requests"
          data={expenses}
          onAction={(id, state) => updateState(EXPENSES_KEY, id, state)}
        />
      )}
      {tab === "excess" && (
        <ReviewTable
          title="Excess Approvals"
          data={excess}
          onAction={(id, state) => updateState(EXCESS_KEY, id, state)}
        />
      )}
      {tab === "deficit" && (
        <ReviewTable
          title="Deficit Disputes"
          data={deficit}
          onAction={(id, state) => updateState(DEFICIT_KEY, id, state)}
        />
      )}

      {tab === "deposits" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Deposits Monitor</h2>
          <div className="table-wrap">
          <table className="w-full text-sm border">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Date</th>
                <th>Outlet</th>
                <th>Amount</th>
                <th>Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-2 text-gray-500">
                    No deposits yet.
                  </td>
                </tr>
              )}
              {deposits.map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="p-2">{d.date}</td>
                  <td className="p-2">{d.outlet}</td>
                  <td className="p-2">Ksh {fmt(d.amount)}</td>
                  <td className="p-2">{d.note || "—"}</td>
                  <td className="p-2">{d.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* ===== Supply View (new tab) ===== */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">
            Supply View — {selectedOutlet === "__ALL__" ? "All Outlets" : selectedOutlet} ({date})
          </h2>

          {/* Lock state + Transfers (only for single-outlet view) */}
          {selectedOutlet !== "__ALL__" && (
            <LockAndTransfer
              date={date}
              outlet={selectedOutlet}
              allOutlets={outlets.map(o => o.name)}
              onChanged={() => setRefreshTick(t => t + 1)}
            />
          )}

          {selectedOutlet === "__ALL__" ? (
            <div className="space-y-6">
              {outlets.map((o) => (
                <SupplyTable key={o.name} date={date} outlet={o.name} refreshTick={refreshTick} />
              ))}
            </div>
          ) : (
            <SupplyTable date={date} outlet={selectedOutlet} refreshTick={refreshTick} />
          )}
        </section>
      )}
    </main>
  );
}

/* ===== Reusable supply table (server-first; falls back to local) ===== */
function SupplyTable({ date, outlet, refreshTick = 0 }: { date: string; outlet: string; refreshTick?: number }) {
  const [rows, setRows] = useState<Array<{ itemKey: string; qty: number }>>([]);

  useEffect(() => {
    (async () => {
      let list: Array<{ itemKey: string; qty: number }> = [];
      try {
        const qs = new URLSearchParams({ date, outlet }).toString();
        const r = await fetch(`/api/supply/opening?${qs}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok && Array.isArray(j.minimal)) {
            list = j.minimal;
            // Mirror to local
            saveLocal(supplierOpeningKey(date, outlet), list);
          }
        }
      } catch {}
      if (!list.length) {
        list = readJSON<Array<{ itemKey: string; qty: number }>>(supplierOpeningKey(date, outlet), []);
      }
      setRows(list || []);
    })();
  }, [date, outlet, refreshTick]);
  const totalQty = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  return (
    <div>
      <div className="text-sm font-medium mb-2">{outlet}</div>
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Item</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="py-2 text-gray-500" colSpan={2}>
                  No opening recorded.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.itemKey}-${i}`} className="border-b">
                  <td className="py-2">{r.itemKey?.toUpperCase?.() || r.itemKey}</td>
                  <td>{fmt(Number(r.qty) || 0)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2 font-semibold">Total Qty</td>
              <td className="font-semibold">{fmt(totalQty)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ===== Lock + Transfer controls (single-outlet view) ===== */
function LockAndTransfer({
  date,
  outlet,
  allOutlets,
  onChanged,
}: {
  date: string;
  outlet: string;
  allOutlets: string[];
  onChanged: () => void;
}) {
  const [locked, setLocked] = useState<boolean>(false);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [toOutlet, setToOutlet] = useState<string>("");
  const [itemKey, setItemKey] = useState<string>("");
  const [qty, setQty] = useState<string>("");

  // fetch lock state
  useEffect(() => {
    (async () => {
      try {
        const qs = new URLSearchParams({ date, outlet }).toString();
        const r = await fetch(`/api/supply/lock?${qs}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setLocked(!!j?.locked);
          setOfflineNote(null);
        } else {
          setOfflineNote("offline – last saved");
        }
      } catch {
        setOfflineNote("offline – last saved");
      }
    })();
  }, [date, outlet]);

  const refreshOpening = async () => {
    try {
      const qs = new URLSearchParams({ date, outlet }).toString();
      const r = await fetch(`/api/supply/opening?${qs}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.ok && Array.isArray(j.minimal)) {
          saveLocal(supplierOpeningKey(date, outlet), j.minimal);
        }
      }
    } catch {}
    onChanged();
  };

  const toggleLock = async () => {
    try {
      const res = await fetch(`/api/supply/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ date, outlet, locked: !locked }),
      });
      if (res.ok) {
        // re-GET lock + opening
        try {
          const qs = new URLSearchParams({ date, outlet }).toString();
          const r = await fetch(`/api/supply/lock?${qs}`, { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            setLocked(!!j?.locked);
            setOfflineNote(null);
          } else {
            setOfflineNote("offline – last saved");
          }
        } catch {
          setOfflineNote("offline – last saved");
        }
        await refreshOpening();
      }
    } catch {}
  };

  const submitTransfer = async () => {
    const qtyNum = Number(qty);
    if (!toOutlet || toOutlet === outlet) return alert("Pick a different outlet");
    if (!itemKey.trim()) return alert("Enter item key");
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return alert("Enter qty > 0");
    try {
      const res = await fetch(`/api/supply/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ date, fromOutletName: outlet, toOutletName: toOutlet, itemKey: itemKey.trim().toLowerCase(), qty: qtyNum }),
      });
      if (res.ok) {
        // refresh current + counterparty openings
        await refreshOpening();
        try {
          const qsB = new URLSearchParams({ date, outlet: toOutlet }).toString();
          const rB = await fetch(`/api/supply/opening?${qsB}`, { cache: "no-store" });
          if (rB.ok) {
            const jB = await rB.json();
            if (jB?.ok && Array.isArray(jB.minimal)) {
              saveLocal(supplierOpeningKey(date, toOutlet), jB.minimal);
            }
          }
        } catch {}
        onChanged();
        setItemKey(""); setQty("");
      }
    } catch {}
  };

  const otherOutlets = allOutlets.filter(o => o && o !== outlet);

  return (
    <div className="rounded-xl border p-3 mb-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">Opening Lock:</span>
        <button className={`text-xs rounded-xl border px-3 py-1 ${locked ? "bg-red-600 text-white" : ""}`} onClick={toggleLock}>
          {locked ? "Locked" : "Unlocked"}
        </button>
        {offlineNote && <span className="text-xs text-gray-600">{offlineNote}</span>}
      </div>
      <div className="h-6 w-px bg-gray-200" />
      <div className="flex items-center gap-2 text-sm">
        <span>Transfer:</span>
        <span className="text-gray-600">from</span>
        <span className="font-medium">{outlet}</span>
        <span className="text-gray-600">to</span>
        <select className="input-mobile border rounded-xl p-1 text-sm" value={toOutlet} onChange={e=>setToOutlet(e.target.value)}>
          <option value="">Select outlet</option>
          {otherOutlets.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input className="input-mobile border rounded-xl p-1 text-sm w-32" placeholder="item key (e.g. beef)" value={itemKey} onChange={e=>setItemKey(e.target.value)} />
        <input className="input-mobile border rounded-xl p-1 text-sm w-24" type="number" min={0} step={0.01} placeholder="qty" value={qty} onChange={e=>setQty(e.target.value)} />
        <button className="btn-mobile border rounded-xl px-3 py-1 text-xs" onClick={submitTransfer}>Submit</button>
      </div>
    </div>
  );
}

/* ===== Review Table (existing) ===== */
function ReviewTable({
  title,
  data,
  onAction,
}: {
  title: string;
  data: ReviewItem[];
  onAction: (id: string, state: "approved" | "rejected") => void;
}) {
  return (
    <section className="rounded-2xl border p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Date</th>
            <th>Outlet</th>
            <th>Item</th>
            <th>Amount</th>
            <th>Note</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="p-2 text-gray-500">
                No items to review
              </td>
            </tr>
          )}
          {data.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.date}</td>
              <td className="p-2">{r.outlet}</td>
              <td className="p-2">{r.item || "—"}</td>
              <td className="p-2">Ksh {fmt(r.amount)}</td>
              <td className="p-2">{r.note || "—"}</td>
              <td className="p-2">{r.state}</td>
              <td className="p-2 flex gap-2">
                {r.state === "pending" && (
                  <>
                    <button
                      onClick={() => onAction(r.id, "approved")}
                      className="text-xs border rounded px-2 py-1 bg-green-600 text-white"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onAction(r.id, "rejected")}
                      className="text-xs border rounded px-2 py-1 bg-red-600 text-white"
                    >
                      Reject
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ===== Small helpers ===== */
function read(key: string): ReviewItem[] { return safeReadJSON<ReviewItem[]>(key, []); }
function save(key: string, value: any) { try { safeWriteJSON(key, value); } catch {} }
function saveLocal(key: string, value: any) { try { safeWriteJSON(key, value); } catch {} }

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
        active ? "bg-black text-white" : "" /* no white background */
      }`}
    >
      {children}
    </button>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

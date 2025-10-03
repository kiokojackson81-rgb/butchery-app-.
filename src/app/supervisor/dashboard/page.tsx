// src/app/supervisor/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { hydrateLocalStorageFromDB, pushAllToDB } from "@/lib/settingsBridge";
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

function ymd() {
  return new Date().toISOString().split("T")[0];
}
function readJSON<T>(k: string, fb: T): T { return safeReadJSON<T>(k, fb); }
function fmt(n: number) {
  return (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function SupervisorDashboard() {
  /* ========= Filters ========= */
  const [date, setDate] = useState<string>(ymd());
  const [outlets, setOutlets] = useState<AdminOutlet[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>("__ALL__");

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

  // Compute outlet names from selection before using in effects
  const outletNames = useMemo(
    () =>
      selectedOutlet === "__ALL__"
        ? outlets.map((o) => o.name)
        : [selectedOutlet],
    [selectedOutlet, outlets]
  );

  // DB-first hydration for daily data (deposits, expenses, waste, supply opening)
  useEffect(() => {
    (async () => {
      try {
        const targets = outletNames.filter(Boolean);
        if (targets.length === 0 || !date) return;

        // Fetch and hydrate per outlet in parallel (lightweight; each endpoint is scoped)
        await Promise.all(
          targets.map(async (outletName) => {
            const query = new URLSearchParams({ date, outlet: outletName }).toString();
            // Deposits
            try {
              const r = await fetch(`/api/deposits?${query}`, { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const rows: Array<{ amount: number }> = (j?.rows || []).map((x: any) => ({ amount: Number(x?.amount || 0) }));
                safeWriteJSON(depositsKey(date, outletName), rows);
              }
            } catch {}
            // Expenses
            try {
              const r = await fetch(`/api/expenses?${query}`, { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const rows: Array<{ amount: number }> = (j?.rows || []).map((x: any) => ({ amount: Number(x?.amount || 0) }));
                safeWriteJSON(expensesDailyKey(date, outletName), rows);
              }
            } catch {}
            // Closing/Waste
            try {
              const r = await fetch(`/api/attendant/closing?${query}`, { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const wasteMap = (j?.wasteMap || {}) as Record<string, number>;
                safeWriteJSON(WASTE_MAP(date, outletName), wasteMap);
              }
            } catch {}
            // Supply Opening (for Supply View)
            try {
              const r = await fetch(`/api/supply/opening?${query}`, { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const rows: Array<{ itemKey: string; qty: number }> = (j?.rows || []).map((x: any) => ({ itemKey: String(x?.itemKey || ""), qty: Number(x?.qty || 0) }));
                safeWriteJSON(supplierOpeningKey(date, outletName), rows);
              }
            } catch {}
            // Server-computed summary (expected, deposits, expenses, till, variance)
            try {
              const r = await fetch(`/api/supervisor/summary?${new URLSearchParams({ date, outlet: outletName }).toString()}`, { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const data = j?.data || {};
                const summary = {
                  expectedKsh: Number(data?.totals?.expectedSales ?? 0),
                  depositedKsh: Number(
                    Array.isArray(data?.deposits)
                      ? data.deposits.reduce((a: number, d: any) => a + (Number(d?.amount) || 0), 0)
                      : 0
                  ),
                  expensesKsh: Number(
                    Array.isArray(data?.expenses)
                      ? data.expenses.reduce((a: number, e: any) => a + (Number(e?.amount) || 0), 0)
                      : 0
                  ),
                  cashAtTill: 0, // computed below
                  varianceKsh: Number(data?.totals?.expectedDeposit ?? 0), // keep name for legacy UI
                } as any;
                summary.cashAtTill = Math.max(0, (summary.expectedKsh || 0) - (summary.depositedKsh || 0) - (summary.expensesKsh || 0));
                safeWriteJSON(summaryKey(date, outletName), summary);
              }
            } catch {}
          })
        );
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, selectedOutlet, JSON.stringify(outlets.map(o => o.name))]);

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
  // outletNames is declared above for earlier use

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
  const downloadPDF = () => window.print();
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
          {/* Thin persistence controls (optional) */}
          <button
            className="btn-mobile px-3 py-2 rounded-xl border text-sm"
            title="Reload Admin settings from DB"
            onClick={async () => {
              try { await hydrateLocalStorageFromDB(); alert("Hydrated Admin settings from DB ✅"); }
              catch { alert("Failed to hydrate from DB."); }
            }}
          >
            Refresh Admin
          </button>
          <button
            className="btn-mobile px-3 py-2 rounded-xl border text-sm"
            title="Push Admin settings from this browser to DB"
            onClick={async () => {
              try { await pushAllToDB(); alert("Pushed Admin settings to DB ✅"); }
              catch { alert("Failed to push to DB."); }
            }}
          >
            Sync to DB
          </button>
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
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPI label="Expected Sales (Ksh)" value={`Ksh ${fmt(agg.expected)}`} />
          <KPI label="Deposits (Ksh)" value={`Ksh ${fmt(agg.deposits)}`} />
          <KPI label="Expenses (Ksh)" value={`Ksh ${fmt(agg.expenses)}`} />
          <KPI label="Cash at Till (Ksh)" value={`Ksh ${fmt(agg.cashAtTill)}`} />
          <KPI label="Variance (Ksh)" value={`Ksh ${fmt(agg.variance)}`} />
        </div>
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

          {selectedOutlet === "__ALL__" ? (
            <div className="space-y-6">
              {outlets.map((o) => (
                <SupplyTable key={o.name} date={date} outlet={o.name} />
              ))}
            </div>
          ) : (
            <SupplyTable date={date} outlet={selectedOutlet} />
          )}

          {/* Transfers list for the selected scope */}
          <div className="mt-6">
            <h3 className="font-medium mb-2">Transfers — {date}</h3>
            <TransfersTable date={date} outlet={selectedOutlet === "__ALL__" ? "" : selectedOutlet} />
          </div>

          {/* Quick Closing Update */}
          {selectedOutlet !== "__ALL__" && (
            <div className="mt-6">
              <h3 className="font-medium mb-2">Quick Closing Update — {selectedOutlet}</h3>
              <QuickClosingUpdate date={date} outlet={selectedOutlet} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/* ===== Reusable supply table (reads supplier_opening_*) ===== */
function SupplyTable({ date, outlet }: { date: string; outlet: string }) {
  const rows =
    readJSON<Array<{ itemKey: string; qty: number }>>(
      supplierOpeningKey(date, outlet),
      []
    ) || [];
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

/* ===== Transfers table (reads /api/supply/transfer) ===== */
function TransfersTable({ date, outlet }: { date: string; outlet: string }) {
  const [rows, setRows] = useState<Array<{ id: string; date: string; fromOutletName: string; toOutletName: string; itemKey: string; qty: number; unit: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const sp = new URLSearchParams({ date });
        if (outlet) sp.set("outlet", outlet);
        const r = await fetch(`/api/supply/transfer?${sp.toString()}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setRows(j?.rows || []);
        } else setRows([]);
      } catch { setRows([]); }
    })();
  }, [date, outlet]);
  return (
    <div className="table-wrap">
      <table className="w-full text-sm border">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Date</th>
            <th className="p-2">From</th>
            <th className="p-2">To</th>
            <th className="p-2">Item</th>
            <th className="p-2">Qty</th>
            <th className="p-2">Unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="p-2 text-gray-500" colSpan={6}>No transfers.</td>
            </tr>
          ) : (
            rows.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="p-2">{t.date}</td>
                <td className="p-2">{t.fromOutletName}</td>
                <td className="p-2">{t.toOutletName}</td>
                <td className="p-2">{t.itemKey}</td>
                <td className="p-2">{fmt(Number(t.qty) || 0)}</td>
                <td className="p-2">{t.unit}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ===== Quick closing update form (supervisor) ===== */
function QuickClosingUpdate({ date, outlet }: { date: string; outlet: string }) {
  const [itemKey, setItemKey] = useState("");
  const [closing, setClosing] = useState<string>("");
  const [waste, setWaste] = useState<string>("");
  const [reason, setReason] = useState("");
  const submit = async () => {
    if (!itemKey) { alert("Pick item key (e.g., beef)"); return; }
    try {
      const res = await fetch("/api/supervisor/closing/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ date, outlet, itemKey, closingQty: closing === "" ? undefined : Number(closing), wasteQty: waste === "" ? undefined : Number(waste), reason }),
      });
      const j = await res.json().catch(()=>({ ok: false }));
      if (!j?.ok) throw new Error(j?.error || "Failed");
      alert("Updated.");
      setItemKey(""); setClosing(""); setWaste(""); setReason("");
    } catch (e: any) {
      alert(e?.message || "Update failed");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 mobile-scroll-x">
      <input className="input-mobile border rounded-xl p-2 text-sm w-40" placeholder="item key (e.g., beef)" value={itemKey} onChange={(e)=>setItemKey(e.target.value)} />
      <input className="input-mobile border rounded-xl p-2 text-sm w-28" type="number" placeholder="closing" value={closing} onChange={(e)=>setClosing(e.target.value)} />
      <input className="input-mobile border rounded-xl p-2 text-sm w-28" type="number" placeholder="waste" value={waste} onChange={(e)=>setWaste(e.target.value)} />
      <input className="input-mobile border rounded-xl p-2 text-sm w-72" placeholder="reason (optional)" value={reason} onChange={(e)=>setReason(e.target.value)} />
      <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={submit}>Save</button>
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

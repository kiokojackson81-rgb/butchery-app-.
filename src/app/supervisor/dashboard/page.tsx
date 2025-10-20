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
  potatoesExpectedDeposit?: number;
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
    "waste" | "expenses" | "excess" | "deficit" | "deposits" | "supply" | "prices" | "commissions"
  >("waste");

  /* ========= Review lists (existing) ========= */
  const [waste, setWaste] = useState<ReviewItem[]>([]);
  const [expenses, setExpenses] = useState<ReviewItem[]>([]);
  const [excess, setExcess] = useState<ReviewItem[]>([]);
  const [deficit, setDeficit] = useState<ReviewItem[]>([]);
  const [deposits, setDeposits] = useState<ReviewItem[]>([]); // legacy supervisor review list (kept for compatibility)
  // New: per-day/outlet deposit monitor data (linked to Admin Recon)
  type DepRow = { id: string; date: string; outletName: string; amount: number; code: string | null; note: string | null; status: "VALID"|"PENDING"|"INVALID"; createdAt?: string };
  const [depRows, setDepRows] = useState<DepRow[]>([]);
  const [depLoading, setDepLoading] = useState<boolean>(false);
  const [depError, setDepError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL'|'VALID'|'PENDING'|'INVALID'>('ALL');
  const [recon, setRecon] = useState<null | { expectedSales: number; expenses: number; depositedValid: number; depositedPending: number; depositedInvalid: number; depositedNonInvalid: number; projectedTill: number; variance: number }>(null);
  const [depTick, setDepTick] = useState<number>(0); // auto-refresh ticker for deposits view
  // Aggregated (All Outlets) deposits + recon
  const [aggDepRows, setAggDepRows] = useState<DepRow[]>([]);
  const [aggRecon, setAggRecon] = useState<null | { expectedSales: number; expenses: number; depositedValid: number; depositedPending: number; depositedInvalid: number; depositedNonInvalid: number; projectedTill: number; variance: number }>(null);
  // Prices view
  const [pricesByOutlet, setPricesByOutlet] = useState<Record<string, Array<{ key: string; name: string; price: number; active: boolean }>>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [pricesFilter, setPricesFilter] = useState<string>("");
  const [showInactive, setShowInactive] = useState<boolean>(false);

  // Day-close status (per outlet/date)
  const [dayStatus, setDayStatus] = useState<{ status: string; submittedAt?: string; lockedAt?: string } | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  const [dayErr, setDayErr] = useState<string | null>(null);

  // Commissions state (supervisor view)
  type CommissionRow = { id: string; date: string; outletName: string; salesKsh: number; expensesKsh: number; wasteKsh: number; profitKsh: number; commissionRate: number; commissionKsh: number; status?: string | null; note?: string | null };
  const [commRows, setCommRows] = useState<CommissionRow[]>([]);
  const [commStatus, setCommStatus] = useState<string>("");
  const [commLoading, setCommLoading] = useState(false);
  const [commError, setCommError] = useState<string | null>(null);
  const [commSort, setCommSort] = useState<{ key: keyof CommissionRow | "date" | "outletName" | "commissionKsh" | "profitKsh" | "status"; dir: "asc" | "desc" }>({ key: "date", dir: "asc" });
  const [commRange, setCommRange] = useState<"day" | "week" | "period">("period");

  function ymdToDate(s: string): Date { return new Date(`${s}T00:00:00.000Z`); }
  function toYMD(d: Date): string { return d.toISOString().slice(0,10); }
  function startOfISOWeek(d: Date): Date { const dt = new Date(d); const day = dt.getUTCDay() || 7; if (day !== 1) dt.setUTCDate(dt.getUTCDate() - (day - 1)); dt.setUTCHours(0,0,0,0); return dt; }
  function endOfISOWeek(d: Date): Date { const s = startOfISOWeek(d); const e = new Date(s); e.setUTCDate(s.getUTCDate()+6); return e; }
  // Commission period: 24th → 23rd (inclusive)
  function commissionPeriodRange(d: Date): { start: string; end: string } {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth(); // 0-based
    const day = d.getUTCDate();
    let start = new Date(Date.UTC(y, m, 24));
    let end = new Date(Date.UTC(y, m + 1, 23));
    if (day < 24) {
      start = new Date(Date.UTC(y, m - 1, 24));
      end = new Date(Date.UTC(y, m, 23));
    }
    return { start: toYMD(start), end: toYMD(end) };
  }

  // Helpers for navigating between periods (history retained across months)
  function periodLabel(pr: { start: string; end: string }) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const s = ymdToDate(pr.start); const e = ymdToDate(pr.end);
    return `${s.getUTCDate()} ${months[s.getUTCMonth()]} ${s.getUTCFullYear()} → ${e.getUTCDate()} ${months[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  }
  function prevPeriodStart(dstr: string): string {
    // Pick the day before current period start, then resolve that period's start
    const pr = commissionPeriodRange(ymdToDate(dstr));
    const dayBefore = ymdToDate(pr.start); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    return commissionPeriodRange(dayBefore).start;
  }
  function nextPeriodStart(dstr: string): string {
    // Pick the day after current period end, then resolve that period's start
    const pr = commissionPeriodRange(ymdToDate(dstr));
    const dayAfter = ymdToDate(pr.end); dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    return commissionPeriodRange(dayAfter).start;
  }

  async function refreshCommissions() {
    try {
      setCommLoading(true); setCommError(null);
      const code = (typeof window !== 'undefined' ? (sessionStorage.getItem('supervisor_code') || "").trim() : "");
      const qs = new URLSearchParams();
      if (date) qs.set('date', date);
      if (selectedOutlet !== "__ALL__") qs.set('outlet', selectedOutlet);
      if (commStatus) qs.set('status', commStatus);
      if (code) qs.set('supervisor', code);
      const r = await fetch(`/api/commission?${qs.toString()}`, { cache: 'no-store' });
      const j = await r.json().catch(()=>({ ok: false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setCommRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setCommError(String(e?.message || e)); setCommRows([]);
    } finally { setCommLoading(false); }
  }
  useEffect(() => {
    if (tab !== "commissions") return;
    refreshCommissions();
  }, [tab, date, selectedOutlet, commStatus]);

  // Day status loader
  async function refreshDayStatus() {
    try {
      setDayErr(null);
      if (!date || selectedOutlet === "__ALL__") { setDayStatus(null); return; }
      const qs = new URLSearchParams({ date, outlet: selectedOutlet });
      const r = await fetch(`/api/day/status?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setDayStatus(j.row || null);
    } catch (e: any) {
      setDayErr(String(e?.message || e)); setDayStatus(null);
    }
  }
  useEffect(() => { refreshDayStatus(); }, [date, selectedOutlet]);

  async function submitCurrentDay() {
    if (!date || selectedOutlet === "__ALL__") return;
    try {
      setDayBusy(true); setDayErr(null);
      const r = await fetch(`/api/day/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlet: selectedOutlet, businessDate: date }) });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || "Submit failed");
      await refreshDayStatus();
    } catch (e: any) {
      setDayErr(String(e?.message || e));
    } finally { setDayBusy(false); }
  }

  async function lockCurrentDay() {
    if (!date || selectedOutlet === "__ALL__") return;
    if (!confirm(`Lock ${selectedOutlet} — ${date}? This finalizes the day.`)) return;
    try {
      setDayBusy(true); setDayErr(null);
      const lockedBy = (typeof window !== 'undefined' ? (sessionStorage.getItem('supervisor_code') || sessionStorage.getItem('supervisor_name') || 'supervisor') : 'supervisor');
      const r = await fetch(`/api/day/lock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlet: selectedOutlet, businessDate: date, lockedBy }) });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || "Lock failed");
      await refreshDayStatus();
    } catch (e: any) {
      setDayErr(String(e?.message || e));
    } finally { setDayBusy(false); }
  }

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

  // Load supervisor Deposits Monitor details when viewing deposits tab and a single outlet is selected
  useEffect(() => {
    (async () => {
      try {
        setDepError(null); setDepRows([]); setRecon(null);
        if (tab !== 'deposits') return;
        if (!date || !selectedOutlet) return;
        // Single-outlet detail
        if (selectedOutlet !== '__ALL__') {
        setDepLoading(true);
        const qs = new URLSearchParams({ date, outlet: selectedOutlet });
        const [rr, rt] = await Promise.all([
          fetch(`/api/admin/recon/day?${qs.toString()}`, { cache: 'no-store' }),
          fetch(`/api/admin/day/txns?${qs.toString()}`, { cache: 'no-store' }),
        ]);
        const jr = await rr.json().catch(()=>({ ok:false }));
        const jt = await rt.json().catch(()=>({ ok:false }));
        if (jr?.ok) setRecon(jr.totals as any);
        if (jt?.ok || jt?.deposits) {
          const list: DepRow[] = (jt?.deposits || []).map((d: any) => ({ id: d.id, date: d.date, outletName: d.outletName, amount: Number(d.amount||0), code: d.code || null, note: d.note || null, status: d.status || 'PENDING', createdAt: d.createdAt }));
          setDepRows(list);
        } else {
          setDepRows([]);
        }
        // Clear any stale aggregated
        setAggDepRows([]); setAggRecon(null);
        } else {
          // All-outlets aggregated view
          setDepLoading(true);
          const names = outlets.map(o => o.name).filter(Boolean);
          const perOutletResults = await Promise.all(names.map(async (name) => {
            try {
              const qs = new URLSearchParams({ date, outlet: name });
              const [rr, rt] = await Promise.all([
                fetch(`/api/admin/recon/day?${qs.toString()}`, { cache: 'no-store' }),
                fetch(`/api/admin/day/txns?${qs.toString()}`, { cache: 'no-store' }),
              ]);
              const jr = await rr.json().catch(()=>({ ok:false }));
              const jt = await rt.json().catch(()=>({ ok:false }));
              const totals = jr?.ok ? (jr.totals as any) : null;
              const rows: DepRow[] = (jt?.deposits || []).map((d: any) => ({ id: d.id, date: d.date, outletName: d.outletName, amount: Number(d.amount||0), code: d.code || null, note: d.note || null, status: d.status || 'PENDING', createdAt: d.createdAt }));
              return { name, totals, rows };
            } catch { return { name, totals: null as any, rows: [] as DepRow[] }; }
          }));
          const allRows = perOutletResults.flatMap(r => r.rows);
          setAggDepRows(allRows);
          // Aggregate totals
          const sum = (k: keyof NonNullable<typeof aggRecon>) => perOutletResults.reduce((a, r) => a + Number((r.totals?.[k as any]) || 0), 0);
          const expectedSales = perOutletResults.reduce((a, r) => a + Number(r.totals?.expectedSales || 0), 0);
          const expenses = perOutletResults.reduce((a, r) => a + Number(r.totals?.expenses || 0), 0);
          const depositedValid = perOutletResults.reduce((a, r) => a + Number(r.totals?.depositedValid || 0), 0);
          const depositedPending = perOutletResults.reduce((a, r) => a + Number(r.totals?.depositedPending || 0), 0);
          const depositedInvalid = perOutletResults.reduce((a, r) => a + Number(r.totals?.depositedInvalid || 0), 0);
          const depositedNonInvalid = depositedValid + depositedPending;
          const projectedTill = expectedSales - depositedNonInvalid - expenses;
          const variance = expectedSales - depositedNonInvalid; // exclude expenses
          setAggRecon({ expectedSales, expenses, depositedValid, depositedPending, depositedInvalid, depositedNonInvalid, projectedTill, variance });
          // Clear any stale single-outlet
          setRecon(null); setDepRows([]);
        }
      } catch (e: any) {
        setDepError(String(e?.message || e)); setDepRows([]);
      } finally { setDepLoading(false); }
    })();
  }, [tab, date, selectedOutlet, depTick]);

  // Auto-refresh deposits monitor every 12s while on Deposits tab
  useEffect(() => {
    if (tab !== 'deposits') return;
    const id = setInterval(() => setDepTick((t) => t + 1), 12000);
    return () => clearInterval(id);
  }, [tab, date, selectedOutlet]);

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
                  potatoesExpectedDeposit: Number(data?.totals?.potatoesExpectedDeposit ?? 0),
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
        potatoesExpectedDeposit?: number;
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
        // New KPI: potatoes expected deposit (Ksh)
        potatoesExpectedDeposit: Number(summary?.potatoesExpectedDeposit || 0),
      });
    });
    return rows;
  }, [date, outletNames]);

  // Load pricebooks for selected scope
  async function refreshPricesView() {
    try {
      setPricesLoading(true);
      setPricesError(null);
      const targets = selectedOutlet === "__ALL__" ? outlets.map(o => o.name) : outletNames;
      const res = await Promise.all(
        targets.map(async (outletName) => {
          if (!outletName) return [outletName, []] as const;
          try {
            const r = await fetch(`/api/pricebook/outlet?outlet=${encodeURIComponent(outletName)}&activeOnly=${showInactive ? "false" : "true"}`, { cache: "no-store" });
            if (!r.ok) throw new Error(await r.text());
            const j = await r.json();
            return [outletName, (Array.isArray(j?.products) ? j.products : [])] as const;
          } catch {
            return [outletName, []] as const;
          }
        })
      );
      const map: Record<string, Array<{ key: string; name: string; price: number; active: boolean }>> = {};
      for (const [outletName, list] of res) map[outletName] = list as any;
      setPricesByOutlet(map);
    } catch (e: any) {
      setPricesError(typeof e?.message === "string" ? e.message : "Failed to load prices");
      setPricesByOutlet({});
    } finally {
      setPricesLoading(false);
    }
  }
  useEffect(() => {
    if (tab !== "prices") return;
    refreshPricesView();
    const id = setInterval(() => refreshPricesView(), 5000);
    return () => clearInterval(id);
  }, [tab, selectedOutlet, showInactive, JSON.stringify(outlets.map(o => o.name))]);

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
          {/* Thin persistence controls removed: now automatic */}
          <a className="btn-mobile px-3 py-2 rounded-xl border text-sm" href="/supervisor/performance" title="Open performance dashboards" target="_self">Performance</a>
          <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={downloadPDF}>
            Download PDF
          </button>
          <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={logout}>
            Logout
          </button>
          {selectedOutlet !== "__ALL__" && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-gray-600">Status:</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${dayStatus?.status === 'LOCKED' ? 'bg-green-600 text-white' : dayStatus?.status === 'SUBMITTED' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-white'}`}>
                {dayStatus?.status || 'OPEN'}
              </span>
              {/* View-only: submit/lock actions removed */}
            </div>
          )}
        </div>
      </header>
      {dayErr && <div className="text-red-600 text-sm mb-3">{dayErr}</div>}

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
        <TabBtn active={tab === "prices"} onClick={() => setTab("prices")}>
          Prices
        </TabBtn>
        <TabBtn active={tab === "commissions"} onClick={() => setTab("commissions")}>
          Commissions
        </TabBtn>
      </nav>

    {/* Inserted menu below review tabs */}
    <div className="rounded-2xl border p-4 mb-6">
      <h2 className="font-semibold mb-2">Waste Requests</h2>
      <div className="table-wrap">
        <table className="w-full text-sm border">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Date</th>
              <th>Outlet</th>
              <th>Item</th>
              <th>Amount</th>
              <th>Note</th>
              <th>State</th>
            </tr>
          </thead>
        </table>
      </div>
    </div>

      {tab === "waste" && (
        <ReviewTable
          title="Waste Requests"
          data={waste}
        />
      )}
      {tab === "expenses" && (
        <ReviewTable
          title="Expense Requests"
          data={expenses}
        />
      )}
      {tab === "excess" && (
        <ReviewTable
          title="Excess Approvals"
          data={excess}
        />
      )}
      {tab === "deficit" && (
        <ReviewTable
          title="Deficit Disputes"
          data={deficit}
        />
      )}

      {tab === "deposits" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Deposits Monitor</h2>
          {selectedOutlet === "__ALL__" ? (
            <>
              {/* Aggregated tiles */}
              <div className="grid sm:grid-cols-6 gap-3 mb-3">
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Total submitted</div><div className="text-lg font-semibold">Ksh {fmt(aggDepRows.reduce((a,r)=>a+Number(r.amount||0),0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Verified (VALID)</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon?.depositedValid ?? aggDepRows.filter(r=>r.status==='VALID').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Pending Only</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon?.depositedPending ?? aggDepRows.filter(r=>r.status==='PENDING').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Invalid (ignored)</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon?.depositedInvalid ?? aggDepRows.filter(r=>r.status==='INVALID').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Expected (server)</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon?.expectedSales ?? 0)}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Expenses</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon?.expenses ?? 0)}</div></div>
              </div>
              <div className="grid sm:grid-cols-6 gap-3 mb-3">
                {(() => {
                  const expected = Number(aggRecon?.expectedSales || 0);
                  const deposited = Number(aggRecon?.depositedNonInvalid ?? aggDepRows.filter(r=>r.status!=='INVALID').reduce((a,r)=>a+r.amount,0));
                  const variance = expected - deposited;
                  return (
                    <div className={`rounded-2xl border p-3 ${variance === 0 ? '' : variance > 0 ? 'border-yellow-400' : 'border-red-400'}`}>
                      <div className="text-xs text-gray-500">Variance (Expected − Deposited)</div>
                      <div className={`text-lg font-semibold ${variance === 0 ? 'text-green-700' : variance > 0 ? 'text-yellow-700' : 'text-red-700'}`}>Ksh {fmt(variance)}</div>
                    </div>
                  );
                })()}
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Projected Till</div><div className="text-lg font-semibold">Ksh {fmt(aggRecon ? aggRecon.projectedTill : 0)}</div></div>
              </div>

              <div className="flex items-center justify-between mb-2 mobile-scroll-x">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Filter</label>
                  <select className="input-mobile border rounded-xl p-2 text-sm" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}>
                    <option value="ALL">ALL</option>
                    <option value="VALID">VALID</option>
                    <option value="PENDING">PENDING</option>
                    <option value="INVALID">INVALID</option>
                  </select>
                </div>
                <button className="btn-mobile px-3 py-2 rounded-xl border text-xs" onClick={()=>{
                  const hdr = ['time','outlet','amount','code','status'];
                  const dat = aggDepRows
                    .filter(r => statusFilter==='ALL' ? true : r.status===statusFilter)
                    .map(r => [r.createdAt ? new Date(r.createdAt).toISOString() : '', r.outletName, r.amount, r.code||'', r.status]);
                  const csv = [hdr.join(','), ...dat.map(a=>a.map(v=>String(v).replaceAll('"','""')).map(v=>/[,\n]/.test(v)?`"${v}"`:v).join(','))].join('\n');
                  const a = document.createElement('a');
                  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                  a.download = `deposits-ALL-${date}.csv`;
                  a.click();
                }}>Export CSV</button>
              </div>

              <div className="table-wrap">
                <table className="w-full text-sm border">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="p-2">Time</th>
                      <th>Outlet</th>
                      <th>Amount</th>
                      <th>Code</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depError && (
                      <tr><td colSpan={5} className="p-2 text-red-700">{depError}</td></tr>
                    )}
                    {!depError && aggDepRows.filter(r=>statusFilter==='ALL'?true:r.status===statusFilter).length === 0 && (
                      <tr><td colSpan={5} className="p-2 text-gray-500">No deposits yet.</td></tr>
                    )}
                    {aggDepRows.filter(r=>statusFilter==='ALL'?true:r.status===statusFilter).map((r)=> (
                      <tr key={r.id} className="border-b">
                        <td className="p-2 whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : r.date}</td>
                        <td className="p-2">{r.outletName}</td>
                        <td className="p-2">Ksh {fmt(r.amount)}</td>
                        <td className="p-2">{r.code || '—'}</td>
                        <td className="p-2">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {/* Tiles from Recon */}
              <div className="grid sm:grid-cols-6 gap-3 mb-3">
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Total submitted</div><div className="text-lg font-semibold">Ksh {fmt(depRows.reduce((a,r)=>a+Number(r.amount||0),0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Verified (VALID)</div><div className="text-lg font-semibold">Ksh {fmt(recon?.depositedValid ?? depRows.filter(r=>r.status==='VALID').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Pending Only</div><div className="text-lg font-semibold">Ksh {fmt(recon?.depositedPending ?? depRows.filter(r=>r.status==='PENDING').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Invalid (ignored)</div><div className="text-lg font-semibold">Ksh {fmt(recon?.depositedInvalid ?? depRows.filter(r=>r.status==='INVALID').reduce((a,r)=>a+r.amount,0))}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Expected (server)</div><div className="text-lg font-semibold">Ksh {fmt(recon?.expectedSales ?? 0)}</div></div>
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Expenses</div><div className="text-lg font-semibold">Ksh {fmt(recon?.expenses ?? 0)}</div></div>
              </div>
              <div className="grid sm:grid-cols-6 gap-3 mb-3">
                {(() => {
                  const expected = Number(recon?.expectedSales || 0);
                  const deposited = Number(recon?.depositedNonInvalid ?? depRows.filter(r=>r.status!=='INVALID').reduce((a,r)=>a+r.amount,0));
                  const variance = expected - deposited; // exclude expenses
                  return (
                    <div className={`rounded-2xl border p-3 ${variance === 0 ? '' : variance > 0 ? 'border-yellow-400' : 'border-red-400'}`}>
                      <div className="text-xs text-gray-500">Variance (Expected − Deposited)</div>
                      <div className={`text-lg font-semibold ${variance === 0 ? 'text-green-700' : variance > 0 ? 'text-yellow-700' : 'text-red-700'}`}>Ksh {fmt(variance)}</div>
                    </div>
                  );
                })()}
                <div className="rounded-2xl border p-3"><div className="text-xs text-gray-500">Projected Till</div><div className="text-lg font-semibold">Ksh {fmt(recon ? recon.projectedTill : 0)}</div></div>
              </div>

              <div className="flex items-center justify-between mb-2 mobile-scroll-x">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Filter</label>
                  <select className="input-mobile border rounded-xl p-2 text-sm" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}>
                    <option value="ALL">ALL</option>
                    <option value="VALID">VALID</option>
                    <option value="PENDING">PENDING</option>
                    <option value="INVALID">INVALID</option>
                  </select>
                </div>
                <button className="btn-mobile px-3 py-2 rounded-xl border text-xs" onClick={()=>{
                  const hdr = ['time','outlet','amount','code','status'];
                  const dat = depRows
                    .filter(r => statusFilter==='ALL' ? true : r.status===statusFilter)
                    .map(r => [r.createdAt ? new Date(r.createdAt).toISOString() : '', r.outletName, r.amount, r.code||'', r.status]);
                  const csv = [hdr.join(','), ...dat.map(a=>a.map(v=>String(v).replaceAll('"','""')).map(v=>/[,\n]/.test(v)?`"${v}"`:v).join(','))].join('\n');
                  const a = document.createElement('a');
                  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                  a.download = `deposits-${selectedOutlet}-${date}.csv`;
                  a.click();
                }}>Export CSV</button>
              </div>

              <div className="table-wrap">
                <table className="w-full text-sm border">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="p-2">Time</th>
                      <th>Outlet</th>
                      <th>Amount</th>
                      <th>Code</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depError && (
                      <tr><td colSpan={5} className="p-2 text-red-700">{depError}</td></tr>
                    )}
                    {!depError && depRows.filter(r=>statusFilter==='ALL'?true:r.status===statusFilter).length === 0 && (
                      <tr><td colSpan={5} className="p-2 text-gray-500">No deposits yet.</td></tr>
                    )}
                    {depRows.filter(r=>statusFilter==='ALL'?true:r.status===statusFilter).map((r)=> (
                      <tr key={r.id} className="border-b">
                        <td className="p-2 whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : r.date}</td>
                        <td className="p-2">{r.outletName}</td>
                        <td className="p-2">Ksh {fmt(r.amount)}</td>
                        <td className="p-2">{r.code || '—'}</td>
                        <td className="p-2">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {/* Sticky quick actions on mobile */}
          <div className="sm:hidden sticky-save-bottom mt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-white/80">Deposits</span>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>Top</button>
                <button className="px-3 py-2 rounded-lg bg-white/10 text-white ring-1 ring-white/20 text-sm" onClick={()=>setTab("supply")}>Supply</button>
              </div>
            </div>
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

          {/* View-only: Quick Closing Update removed */}
        </section>
      )}

      {/* ===== Prices (per outlet) ===== */}
      {tab === "prices" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2 mobile-scroll-x gap-2">
            <h2 className="font-semibold">Outlet Prices — {selectedOutlet === "__ALL__" ? "All Outlets" : selectedOutlet}</h2>
            <div className="flex items-center gap-2">
              <input className="input-mobile border rounded-xl p-2 text-sm w-48" placeholder="Filter product/key" value={pricesFilter} onChange={(e)=>setPricesFilter(e.target.value)} />
              <label className="text-xs text-gray-700 inline-flex items-center gap-1">
                <input type="checkbox" checked={showInactive} onChange={(e)=>setShowInactive(e.target.checked)} /> Show inactive
              </label>
              {/* Manual Refresh removed; relies on auto-refresh every 5s */}
            </div>
          </div>
          {pricesError && <div className="text-red-700 text-sm mb-2">{pricesError}</div>}
          {selectedOutlet === "__ALL__" ? (
            <div className="space-y-5">
              {outlets.map((o) => (
                <div key={o.name}>
                  <div className="text-sm font-medium mb-1">{o.name}</div>
                  <div className="table-wrap">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2">Product</th>
                          <th>Key</th>
                          <th>Price (Ksh)</th>
                          <th>Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pricesByOutlet[o.name] || []).filter(p => !pricesFilter || p.name.toLowerCase().includes(pricesFilter.toLowerCase()) || p.key.toLowerCase().includes(pricesFilter.toLowerCase())).length === 0 ? (
                          <tr><td className="py-2 text-gray-500" colSpan={4}>No products.</td></tr>
                        ) : (
                          (pricesByOutlet[o.name] || [])
                            .filter(p => !pricesFilter || p.name.toLowerCase().includes(pricesFilter.toLowerCase()) || p.key.toLowerCase().includes(pricesFilter.toLowerCase()))
                            .map((p, i) => (
                            <tr key={`${o.name}-${p.key}-${i}`} className="border-b">
                              <td className="py-2">{p.name}</td>
                              <td><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{p.key}</code></td>
                              <td>Ksh {fmt(Number(p.price) || 0)}</td>
                              <td>{p.active ? "Yes" : "No"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Product</th>
                    <th>Key</th>
                    <th>Price (Ksh)</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {(pricesByOutlet[selectedOutlet] || []).filter(p => !pricesFilter || p.name.toLowerCase().includes(pricesFilter.toLowerCase()) || p.key.toLowerCase().includes(pricesFilter.toLowerCase())).length === 0 ? (
                    <tr><td className="py-2 text-gray-500" colSpan={4}>No products.</td></tr>
                  ) : (
                    (pricesByOutlet[selectedOutlet] || [])
                      .filter(p => !pricesFilter || p.name.toLowerCase().includes(pricesFilter.toLowerCase()) || p.key.toLowerCase().includes(pricesFilter.toLowerCase()))
                      .map((p, i) => (
                      <tr key={`${selectedOutlet}-${p.key}-${i}`} className="border-b">
                        <td className="py-2">{p.name}</td>
                        <td><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{p.key}</code></td>
                        <td>Ksh {fmt(Number(p.price) || 0)}</td>
                        <td>{p.active ? "Yes" : "No"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">Auto-refreshes every 5s.</p>
        </section>
      )}

      {tab === "commissions" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x gap-2">
            <h2 className="font-semibold">My Commissions — {selectedOutlet === "__ALL__" ? "All Outlets" : selectedOutlet} ({date})</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-700">Range</label>
              <select className="input-mobile border rounded-xl p-2 text-sm" value={commRange} onChange={(e)=>setCommRange(e.target.value as any)}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="period">Period</option>
              </select>
              {/* Period navigation (history) */}
              {commRange === 'period' && (() => {
                const today = new Date();
                const curr = commissionPeriodRange(ymdToDate(date));
                const todayPr = commissionPeriodRange(today);
                const prevStart = prevPeriodStart(date);
                const nextStart = nextPeriodStart(date);
                const nextDisabled = nextStart > todayPr.start; // prevent navigating into future period
                return (
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-mobile px-2 py-1 rounded-xl border text-xs"
                      title="Previous period"
                      onClick={() => setDate(prevStart)}
                    >← Prev</button>
                    <div className="text-[11px] text-gray-600 px-1">{periodLabel(curr)}</div>
                    <button
                      className="btn-mobile px-2 py-1 rounded-xl border text-xs disabled:opacity-50"
                      title="Next period"
                      onClick={() => !nextDisabled && setDate(nextStart)}
                      disabled={nextDisabled}
                    >Next →</button>
                  </div>
                );
              })()}
              <label className="text-xs text-gray-700">Status</label>
              <select className="input-mobile border rounded-xl p-2 text-sm" value={commStatus} onChange={(e)=>setCommStatus(e.target.value)}>
                <option value="">(any)</option>
                <option value="calculated">calculated</option>
                <option value="approved">approved</option>
                <option value="paid">paid</option>
              </select>
              {/* Quick status chips */}
              <div className="hidden sm:flex items-center gap-1 ml-1">
                {[
                  {k:"", label:"All"},
                  {k:"calculated", label:"Calculated"},
                  {k:"approved", label:"Approved"},
                  {k:"paid", label:"Paid"},
                ].map(c => (
                  <button key={c.k} onClick={()=>setCommStatus(c.k)} className={`text-[11px] px-2 py-0.5 rounded-full border ${commStatus===c.k? 'bg-black text-white':'bg-transparent'}`}>{c.label}</button>
                ))}
              </div>
              <button className="btn-mobile px-3 py-2 rounded-xl border text-sm" onClick={refreshCommissions} disabled={commLoading}>{commLoading ? 'Loading…' : 'Refresh'}</button>
            </div>
          </div>
          {commError && <div className="text-red-600 text-sm mb-2">{commError}</div>}
          {(() => {
            const dateObj = ymdToDate(date);
            const d0 = toYMD(dateObj);
            const ws = startOfISOWeek(dateObj); const we = endOfISOWeek(dateObj);
            const w0 = toYMD(ws); const w1 = toYMD(we);
            const pr = commissionPeriodRange(dateObj);
            const inRange = (dstr: string) => {
              if (commRange === 'period') return dstr >= pr.start && dstr <= pr.end;
              if (commRange === 'day') return dstr === d0;
              if (commRange === 'week') return dstr >= w0 && dstr <= w1;
              return true;
            };
            const filtered = commRows.filter(r => inRange(r.date));
            const totals = filtered.reduce((a,r)=>{ a.sales+=r.salesKsh; a.expenses+=r.expensesKsh; a.waste+=r.wasteKsh; a.profit+=r.profitKsh; a.comm+=r.commissionKsh; return a; }, { sales:0, expenses:0, waste:0, profit:0, comm:0 });
            return (
              <div className="text-sm text-gray-700 mb-2">
                Totals — Sales: Ksh {fmt(totals.sales)} · Expenses: Ksh {fmt(totals.expenses)} · Waste: Ksh {fmt(totals.waste)} · Profit: Ksh {fmt(totals.profit)} · Commission: Ksh {fmt(totals.comm)}
                {commRange === 'week' && <span className="ml-2 text-gray-500">Week: {w0} → {w1}</span>}
                {commRange === 'period' && <span className="ml-2 text-gray-500">Period: {pr.start} → {pr.end}</span>}
              </div>
            );
          })()}
          <div className="table-wrap">
            <table className="w-full text-sm border">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2 cursor-pointer" onClick={()=>setCommSort(s=>({ key: 'date', dir: s.key==='date' && s.dir==='asc' ? 'desc' : 'asc' }))}>Date</th>
                  <th className="p-2 cursor-pointer" onClick={()=>setCommSort(s=>({ key: 'outletName', dir: s.key==='outletName' && s.dir==='asc' ? 'desc' : 'asc' }))}>Outlet</th>
                  <th className="p-2">Sales</th>
                  <th className="p-2">Expenses</th>
                  <th className="p-2">Waste</th>
                  <th className="p-2 cursor-pointer" onClick={()=>setCommSort(s=>({ key: 'profitKsh', dir: s.key==='profitKsh' && s.dir==='asc' ? 'desc' : 'asc' }))}>Profit</th>
                  <th className="p-2">Rate</th>
                  <th className="p-2 cursor-pointer" onClick={()=>setCommSort(s=>({ key: 'commissionKsh', dir: s.key==='commissionKsh' && s.dir==='asc' ? 'desc' : 'asc' }))}>Commission</th>
                  <th className="p-2 cursor-pointer" onClick={()=>setCommSort(s=>({ key: 'status', dir: s.key==='status' && s.dir==='asc' ? 'desc' : 'asc' }))}>Status</th>
                  <th className="p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const dateObj = ymdToDate(date);
                  const ws = startOfISOWeek(dateObj); const we = endOfISOWeek(dateObj);
                  const w0 = toYMD(ws); const w1 = toYMD(we);
                  const pr = commissionPeriodRange(dateObj);
                  const inRange = (dstr: string) => {
                    if (commRange === 'period') return dstr >= pr.start && dstr <= pr.end;
                    if (commRange === 'day') return dstr === toYMD(dateObj);
                    if (commRange === 'week') return dstr >= w0 && dstr <= w1;
                    return true;
                  };
                  const visible = commRows.filter(r => inRange(r.date));
                  if (visible.length === 0) return (<tr><td className="p-2 text-gray-500" colSpan={10}>No commission entries.</td></tr>);
                  const sorted = [...visible].sort((a,b)=>{
                    const dir = commSort.dir === 'asc' ? 1 : -1;
                    const ka: any = (a as any)[commSort.key];
                    const kb: any = (b as any)[commSort.key];
                    if (ka == null && kb != null) return -1*dir;
                    if (ka != null && kb == null) return 1*dir;
                    if (ka < kb) return -1*dir; if (ka > kb) return 1*dir; return 0;
                  });
                  const chip = (s?: string | null) => {
                    const st = String(s || 'calculated');
                    const cls = st === 'paid' ? 'bg-green-600 text-white' : st === 'approved' ? 'bg-emerald-600 text-white' : st === 'adjusted' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-white';
                    return <span className={`text-[11px] px-2 py-0.5 rounded-full ${cls}`}>{st}</span>;
                  };
                  return (
                    <>
                      {sorted.map(r => (
                        <tr key={r.id} className="border-b">
                          <td className="p-2">{r.date}</td>
                          <td className="p-2">{r.outletName}</td>
                          <td className="p-2">Ksh {fmt(r.salesKsh)}</td>
                          <td className="p-2">Ksh {fmt(r.expensesKsh)}</td>
                          <td className="p-2">Ksh {fmt(r.wasteKsh)}</td>
                          <td className="p-2">Ksh {fmt(r.profitKsh)}</td>
                          <td className="p-2">{(r.commissionRate*100).toFixed(1)}%</td>
                          <td className="p-2">Ksh {fmt(r.commissionKsh)}</td>
                          <td className="p-2">{chip(r.status)}</td>
                          <td className="p-2">{r.note || '—'}</td>
                        </tr>
                      ))}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
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
// View-only: QuickClosingUpdate component removed
/* ===== Review Table (existing) ===== */
function ReviewTable({
  title,
  data,
}: {
  title: string;
  data: ReviewItem[];
}) {
  return (
    <section className="rounded-2xl border p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className="table-wrap">
        <table className="w-full text-sm border">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Date</th>
              <th className="p-2">Outlet</th>
              <th className="p-2">Item</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Note</th>
              <th className="p-2">State</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">{r.date}</td>
                <td className="p-2">{r.outlet}</td>
                <td className="p-2">{r.item || "—"}</td>
                <td className="p-2">Ksh {fmt(r.amount)}</td>
                <td className="p-2">{r.note || "—"}</td>
                <td className="p-2">{r.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

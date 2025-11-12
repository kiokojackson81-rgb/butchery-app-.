// src/app/attendant/dashboard/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { hydrateLocalStorageFromDB } from "@/lib/settingsBridge";
import { readJSON as safeReadJSON } from "@/utils/safeStorage";
import { promptSync, confirmSync } from '@/lib/ui';
import { notifyToast, registerAdminToast } from '@/lib/toast';
import QuickStkDeposit from '@/components/QuickStkDeposit';
import { isGeneralDepositAttendant } from '@/server/general_deposit';

/** ========= Types ========= */
type Unit = "kg" | "pcs";
type ItemKey =
  | "beef" | "goat" | "liver" | "kuku" | "matumbo"
  | "potatoes" | "samosas" | "mutura";

type Row = { key: ItemKey; name: string; unit: Unit; opening: number; closing: number | string | ""; waste: number | string | "" };
type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";
type Deposit = { id: string; code: string; amount: number | string | ""; note?: string; status?: "VALID"|"PENDING"|"INVALID"; createdAt?: string };
type AdminProduct = { key: ItemKey; name: string; unit: Unit; sellPrice: number; active: boolean; };
type AdminOutlet = { name: string; code: string; active: boolean };
type TillPaymentRow = { time: string; amount: number; code?: string | null; customer?: string; ref?: string };

/** ========= Keys (unchanged) ========= */
const ADMIN_OUTLETS_KEY = "admin_outlets";
const ADMIN_PRODUCTS_KEY = "admin_products";

// localStorage keys are no longer sources of truth; only read when harmless
// Removed deposit localStorage fallback — DB is the only source of truth

const SCOPE_KEY = "attendant_scope";
const PRICEBOOK_KEY = "admin_pricebook";

/** ========= Helpers ========= */
function toNum(v: number | string | "" | undefined) { return typeof v === "number" ? v : (v === "" || v == null) ? 0 : Number(v); }
function fmt(n: number | undefined | null) {
  const num = typeof n === "number" && isFinite(n) ? n : 0;
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function today() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/\//g, "-"); } catch { return new Date().toISOString().split("T")[0]; }
}
function prevDate(d: string) { try { const dt = new Date(`${d}T00:00:00+03:00`); dt.setUTCDate(dt.getUTCDate() - 1); return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(dt).replace(/\//g, "-"); } catch { const dt = new Date(d + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1); return dt.toISOString().slice(0,10); } }
function nextDate(d: string) { try { const dt = new Date(`${d}T00:00:00+03:00`); dt.setUTCDate(dt.getUTCDate() + 1); return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(dt).replace(/\//g, "-"); } catch { const dt = new Date(d + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0,10); } }
function summaryKeyFor(date: string, outlet: string) { return `attendant_summary_${date}_${outlet}`; }
function rotationBannerKeyFor(date: string, outlet: string) { return `attendant_rotation_banner_${date}_${outlet}`; }
function id() { return Math.random().toString(36).slice(2); }
// Note: We deliberately avoid reading non-bridged keys from localStorage.
// writeJSON removed; we no longer persist to localStorage as primary store

/** ========= Waste helper ========= */
function askWaste(unit: Unit, current: number | string | ""): number | null {
  const init = current === "" ? "" : String(current);
  const raw = promptSync(`Enter waste in ${unit}`, init) ?? "";
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) { try { notifyToast("Enter a non-negative number"); } catch {} ; return null; }
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
  const router = useRouter();

  const [dateStr] = useState(today()); // locked to today
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [catalog, setCatalog] = useState<Record<ItemKey, AdminProduct>>({} as any);

  const [rows, setRows] = useState<Row[]>([]);
  const [locked, setLocked] = useState<Record<string, boolean>>({}); // per-item stock row saved flag
  const [openingRowsRaw, setOpeningRowsRaw] = useState<Array<{ itemKey: string; qty: number; unit?: string }>>([]);
  const [supplyHistory, setSupplyHistory] = useState<Array<{ date: string; itemKey: string; name: string; qty: number; unit: string }>>([]);
  // For transparency: show OpeningEff = yesterday closing + today supply per item
  const [prevClosingLc, setPrevClosingLc] = useState<Record<string, number>>({}); // keys lowercased

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositsFromServer, setDepositsFromServer] = useState<Array<{ code?: string; amount: number; note?: string; status?: "VALID"|"PENDING"|"INVALID"; createdAt?: string }>>([]);
  const [expenses, setExpenses] = useState<Array<{ id: string; name: string; amount: number | string | ""; saved?: boolean }>>([]);
  const [countedTill, setCountedTill] = useState<number | "">("");

  const [tab, setTab] = useState<"stock" | "products" | "supply" | "deposits" | "expenses" | "till" | "summary">("stock");
  const [submitted, setSubmitted] = useState(false);
  const [activeFrom, setActiveFrom] = useState<string | null>(null);
  const [summaryMode, setSummaryMode] = useState<"current" | "previous">("current");
  // Date used for stock rows (opening/closing overlay). Defaults to today's date, moves to next day after rotation.
  const [stockDate, setStockDate] = useState<string>(today());
  const [showRotationBanner, setShowRotationBanner] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittingStock, setSubmittingStock] = useState(false);
  const [invalidByKey, setInvalidByKey] = useState<Record<ItemKey, string>>({} as any);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refreshingKpi, setRefreshingKpi] = useState(false);

  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(id);
  }, [toastMsg]);

  function _localNotify(msg: string|null) { try { setToastMsg(msg); } catch {} }

  useEffect(() => { registerAdminToast((m) => _localNotify(m)); return () => { try { registerAdminToast(null); } catch {} } }, []);

  // Products tab state
  const [products, setProducts] = useState<Array<{ key: string; name: string; price: number; updatedAt?: string }>>([]);
  const [productsOutlet, setProductsOutlet] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  // Thin persistence: ensure admin settings are hydrated from DB first
  useEffect(() => {
    (async () => {
      try { await hydrateLocalStorageFromDB(); } catch {}
    })();
  }, []);

  // Trading period + header KPIs
  const [periodStartAt, setPeriodStartAt] = useState<string | null>(null);
  const [kpi, setKpi] = useState<{ weightSales: number; expenses: number; todayTotalSales: number; tillSalesNet: number; tillSalesGross: number; verifiedDeposits: number; amountToDeposit: number; carryoverPrev: number; openingValue?: number }>(
    {
      weightSales: 0,
      expenses: 0,
      todayTotalSales: 0,
      tillSalesNet: 0,
      tillSalesGross: 0,
      verifiedDeposits: 0,
      amountToDeposit: 0,
      carryoverPrev: 0,
      openingValue: 0,
    }
  );
  // Subscribe to server-sent events for instant Till updates
  useEffect(() => {
    if (!outlet) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/events/till?outlet=${encodeURIComponent(String(outlet))}`);
      es.addEventListener('till', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          const delta = Number(data?.delta || 0);
          const gross = Number(data?.gross || 0);
          if (!Number.isFinite(delta)) return;
          // Update Till Sales (Gross) immediately
          setKpi((prev) => {
            const baseGross = Number(prev.tillSalesGross || 0);
            const nextGross = Number.isFinite(gross) ? gross : (baseGross + delta);
            // Reduce Amount to Deposit by the delta immediately; allow negative
            const nextAmtToDeposit = Number(prev.amountToDeposit || 0) - delta;
            return { ...prev, tillSalesGross: nextGross, todayTillSales: nextGross as any, amountToDeposit: nextAmtToDeposit } as any;
          });
        } catch {}
      });
    } catch {}
    return () => { try { es?.close(); } catch {} };
  }, [outlet]);
  const [tillRows, setTillRows] = useState<TillPaymentRow[]>([]);
  const [tillTotal, setTillTotal] = useState(0);
  const [tillSort, setTillSort] = useState<'createdAt:asc' | 'createdAt:desc'>('createdAt:desc');
  const [attendantName, setAttendantName] = useState<string | null>(null);
  const [attendantCode, setAttendantCode] = useState<string | null>(null);
  const [isGeneralDeposit, setIsGeneralDeposit] = useState(false);
  const [isAssistantRole, setIsAssistantRole] = useState(false);
  const [assistantInsights, setAssistantInsights] = useState<{
    expected: number;
    recommendedNow: number;
    depositedSoFar: number;
    salesValue: number;
    expensesValue: number;
    periodState: string;
    warnings?: string[];
    breakdown?: Array<{ productKey: string; productName: string; salesUnits: number; salesValue: number; price: number }>;
  } | null>(null);
  const [attendantPhone, setAttendantPhone] = useState<string | null>(null);
  const [outletCodeState, setOutletCodeState] = useState<string | null>(null);
  const [tillNumber, setTillNumber] = useState<string | null>(null);
  // Track whether there's any saved activity for today (closings, expenses, deposits, tillcount)
  const [savedClosingTodayCount, setSavedClosingTodayCount] = useState<number>(0);
  const assistantMode = useMemo(() => isGeneralDeposit || isAssistantRole || !!assistantInsights, [isGeneralDeposit, isAssistantRole, assistantInsights]);

  /** ===== Resolve outlet + products ===== */
  useEffect(() => {
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" });
        if (me.ok) {
          const j = await me.json();
          // Fast-path: if server already provided outlet name, use it immediately
          const outletNameFromMe = (j?.outlet?.name || "").toString();
          if (outletNameFromMe) {
            setOutlet(outletNameFromMe as Outlet);
          }
          const nm = (j?.attendant?.name || "").toString();
          if (nm) setAttendantName(nm);
          const roleRaw = (j?.attendant?.role || "").toString().toLowerCase();
          if (roleRaw === "assistant") {
            setIsAssistantRole(true);
            setIsGeneralDeposit(true);
          }
          const cd = (j?.attendant?.code || "").toString();
          if (cd) setAttendantCode(cd);
          // Try to capture attendant phone (E.164) if server returned it
          const phone = (j?.attendant?.phoneE164 || j?.attendant?.phone || j?.phoneE164 || j?.phone || "").toString();
          if (phone) setAttendantPhone(phone);
          const outletCode = (j?.outletCode || "").toString();
          if (outletCode) {
            try {
              setOutletCodeState(outletCode || null);
              const r = await fetch(`/api/outlets/${encodeURIComponent(outletCode)}`, { cache: "no-store" });
              if (r.ok) {
                const data = await r.json();
                const name = data?.outlet?.name || null;
                if (name) setOutlet(name as Outlet);
              }
            } catch {}
          }
        } else {
          router.replace("/attendant");
          return;
        }
      } catch {
        router.replace("/attendant");
        return;
      }

      // Detect special attendant (general deposit allow-list). Runs when attendantCode resolves.
  useEffect(() => {
    if (!attendantCode || isAssistantRole) return;
    (async () => {
      try {
        const r = await fetch(`/api/settings/general-deposit?code=${encodeURIComponent(attendantCode)}`);
        if (r.ok) {
          const j = await r.json();
          setIsGeneralDeposit(!!j?.isGeneralDeposit);
        } else {
          // Fallback client-side (non-blocking): we can skip if endpoint not present yet.
        }
      } catch {}
    })();
  }, [attendantCode, isAssistantRole]);
      // Important: Do NOT pre-populate catalog from admin products.
      // Catalog must be driven strictly by attendant scope to avoid leakage across attendants.
    })();
  }, [router]);

  // Resolve and show this outlet's till number (read-only), and ensure Till Payments are scoped to the outlet only
  useEffect(() => {
    const mapNameToCode: Record<string, string> = {
      "Bright": "BRIGHT",
      "Baraka A": "BARAKA_A",
      "Baraka B": "BARAKA_B",
      "Baraka C": "BARAKA_C",
      "General": "GENERAL",
    };
    const code = outletCodeState || (outlet ? mapNameToCode[String(outlet)] : null);
    if (!code) return;
    (async () => {
      try {
        const res = await fetch('/api/tills/list', { cache: 'no-store' });
        const j = await res.json();
        const rows = Array.isArray(j?.rows) ? j.rows : [];
        const match = rows.find((r: any) => String(r?.outletCode) === String(code));
        setTillNumber(match?.tillNumber || null);
      } catch { setTillNumber(null); }
    })();
  }, [outlet, outletCodeState]);

  /** ===== Scope & pricebook overlays (unchanged) ===== */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/attendant/scope", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (j?.outlet) setOutlet(j.outlet as Outlet);
        if (Array.isArray(j?.productKeys)) {
          // Build a fresh catalog strictly from assigned keys
          const next: Record<ItemKey, AdminProduct> = {} as any;
          (j.productKeys as string[]).forEach((k: any) => {
            const key = String(k) as ItemKey;
            // Try to preserve existing metadata if present; otherwise default
            const prev = (next as any)[key] || ({} as Partial<AdminProduct>);
            (next as any)[key] = {
              key,
              name: (prev as any).name || key.toUpperCase(),
              unit: (prev as any).unit || "kg",
              sellPrice: Number((prev as any).sellPrice || 0),
              active: true,
            } as AdminProduct;
          });
          setCatalog(next);
        } else {
          // No keys resolved -> clear catalog to avoid showing unassigned items
          setCatalog({} as any);
        }
      } catch {
        // On failure, do not widen catalog; keep as-is
      }
    })();
  }, []);

  useEffect(() => {
    if (!outlet) return;
    try {
      const all = safeReadJSON<Record<string, Record<ItemKey, { sellPrice: number; active: boolean }>>>(PRICEBOOK_KEY, {} as any);
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

  /** ===== Products tab: fetch and live refresh ===== */
  // Auto-dismiss toast after a short delay
  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(null), 5000);
    return () => clearTimeout(id);
  }, [toastMsg]);

  async function refreshProducts() {
    try {
      setProductsLoading(true);
      setProductsError(null);
      const res = await getJSON<{ ok: boolean; outlet: string; attendantCode?: string; products: Array<{ key: string; name: string; price: number; updatedAt?: string }> }>(
        "/api/attendant/products"
      );
      if (res && res.ok) {
        setProducts(res.products || []);
        setProductsOutlet(res.outlet || null);
        // Overwrite catalog strictly with assigned products from server
        if (Array.isArray(res.products)) {
          const next: Record<ItemKey, AdminProduct> = {} as any;
          for (const p of res.products) {
            const k = p.key as ItemKey;
            next[k] = {
              key: k,
              name: (p.name || String(k)) as any,
              unit: "kg", // Unit is not provided here; default to kg
              sellPrice: Number(p.price || 0),
              active: true,
            } as any;
          }
          setCatalog(next);
        } else {
          setCatalog({} as any);
        }
      } else {
        setProducts([]);
        setProductsOutlet(null);
        setProductsError("Failed to load products");
        setCatalog({} as any);
      }
    } catch (e: any) {
      setProductsError(typeof e?.message === "string" ? e.message : "Failed to load products");
      setProducts([]);
      setProductsOutlet(null);
      setCatalog({} as any);
    } finally {
      setProductsLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "products") return;
    refreshProducts();
    const id = setInterval(() => {
      refreshProducts();
    }, 5000); // lightweight polling for immediate admin changes
    return () => clearInterval(id);
  }, [tab]);

  /** ===== Load opening + saved data ===== */
  useEffect(() => {
    if (!outlet) return;

    // Opening rows from DB for the active calendar date (today).
    (async () => {
      try {
  const r = await getJSON<{ ok: boolean; rows: Array<{ itemKey: ItemKey; qty: number }> }>(`/api/stock/opening-effective?date=${encodeURIComponent(stockDate)}&outlet=${encodeURIComponent(String(outlet))}`);
        setOpeningRowsRaw(r.rows || []);
      } catch { setOpeningRowsRaw([]); }
    })();

    // Supply history (last 7 days, attendant scope)
    (async () => {
      async function loadHist() {
        const res = await fetch(`/api/supply/history?days=7&sort=date_desc`, { cache: "no-store" });
        if (res.status === 401) {
          // Retry once after a short delay to allow session hydration
          await new Promise(r => setTimeout(r, 400));
          const res2 = await fetch(`/api/supply/history?days=7&sort=date_desc`, { cache: "no-store" });
          if (!res2.ok) throw new Error("history unauthorized");
          const j2 = await res2.json();
          setSupplyHistory((j2 as any).rows || []);
          return;
        }
        if (!res.ok) throw new Error("history failed");
        const j = await res.json();
        setSupplyHistory((j as any).rows || []);
      }
      try { await loadHist(); } catch { setSupplyHistory([]); }
    })();

    // Yesterday's closings (for OpeningEff breakdown)
    (async () => {
      try {
        const prev = prevDate(stockDate);
  const j = await getJSON<{ ok: boolean; closingMap: Record<string, number> }>(`/api/attendant/closing?date=${encodeURIComponent(prev)}&outlet=${encodeURIComponent(String(outlet))}`);
        const m: Record<string, number> = {};
        Object.entries(j?.closingMap || {}).forEach(([k, v]) => { m[String(k).toLowerCase()] = Number(v || 0); });
        setPrevClosingLc(m);
      } catch { setPrevClosingLc({}); }
    })();

    // deposits from DB (server source of truth)
    (async () => {
      try {
  const r = await getJSON<{ ok: boolean; rows: Array<{ code?: string; amount: number; note?: string; status?: "VALID"|"PENDING"|"INVALID"; createdAt?: string }> }>(`/api/deposits?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
        setDepositsFromServer(r.rows || []);
      } catch {
        setDepositsFromServer([]);
      }
    })();

    // expenses from DB — merge with any unsaved local rows to avoid UI disappearing
    (async () => {
      try {
  const r = await getJSON<{ ok: boolean; rows: Array<{ name: string; amount: number }> }>(`/api/expenses?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
        const fromServer = (r.rows || []).map((e) => ({ id: id(), name: e.name, amount: e.amount as any, saved: true }));
        setExpenses((prev) => {
          const unsaved = (prev || []).filter((x) => !x.saved);
          const key = (o: { name: string; amount: any }) => `${(o.name || '').trim().toLowerCase()}|${Number(o.amount) || 0}`;
          const seen = new Set(fromServer.map(key));
          const mergedUnsaved = unsaved.filter((u) => !seen.has(key(u as any)));
          return [...fromServer, ...mergedUnsaved];
        });
      } catch {
        // Preserve existing unsaved when server fails
        setExpenses((prev) => (prev || []).filter((x) => !x.saved));
      }
    })();

    // tillcount from DB (optional)
    (async () => {
      try {
  const r = await getJSON<{ ok: boolean; counted: number }>(`/api/tillcount?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
        setCountedTill(typeof r.counted === "number" ? r.counted : "");
      } catch { setCountedTill(""); }
    })();

    // API-backed bits (respect persisted summary mode)
    (async () => {
      try {
        const key = summaryKeyFor(dateStr, outlet);
        const saved = (typeof window !== 'undefined' ? window.localStorage.getItem(key) : null) || 'current';
        const mode = saved === 'previous' ? 'previous' : 'current';
        setSummaryMode(mode as any);
  await refreshPeriodAndHeader(outlet, mode === 'previous' ? dateStr : undefined, mode === 'previous');
        // Initialize rotation banner visibility from storage if present
        try {
          const bKey = rotationBannerKeyFor(dateStr, outlet);
          const bVal = window.localStorage.getItem(bKey);
          setShowRotationBanner(bVal === 'show');
        } catch {}
      } catch {
        await refreshPeriodAndHeader(outlet);
      }
    })();
    refreshTill(outlet).catch(()=>{});
    setSubmitted(false);
  }, [dateStr, outlet, catalog, stockDate]);

  // Auto-refresh Deposits when deposits tab is active
  useEffect(() => {
    if (!outlet || tab !== "deposits") return;
    let cancelled = false;
    const outletName = outlet as string;
    async function pullDeposits() {
      try {
        const r = await getJSON<{ ok: boolean; rows: Array<{ code?: string; amount: number; note?: string; status?: "VALID"|"PENDING"|"INVALID"; createdAt?: string }> }>(`/api/deposits?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(outletName)}`);
        if (cancelled) return;
        setDepositsFromServer(r.rows || []);
      } catch {}
    }
    pullDeposits();
  const id = setInterval(pullDeposits, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab, outlet, dateStr]);

  // When deposits list changes (e.g., a deposit becomes VERIFIED), refresh KPIs so Amount to Deposit updates immediately
  useEffect(() => {
    if (!outlet) return;
    // Debounce quick successive updates
    let t: any = null;
    t = setTimeout(() => {
      (async () => {
        try {
          setRefreshingKpi(true);
          await refreshPeriodAndHeader(outlet).catch(() => {});
        } catch {} finally {
          setRefreshingKpi(false);
        }
      })();
    }, 300);
    return () => { if (t) clearTimeout(t); };
  }, [depositsFromServer.length, depositsFromServer.map(d => d.status).join('|') , outlet]);

  // Auto-refresh Expenses when expenses tab is active
  useEffect(() => {
    if (!outlet || tab !== "expenses") return;
    let cancelled = false;
    const outletName = outlet as string;
    async function pullExpenses() {
      try {
        const r = await getJSON<{ ok: boolean; rows: Array<{ name: string; amount: number }> }>(`/api/expenses?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(outletName)}`);
        if (cancelled) return;
        const fromServer = (r.rows || []).map((e) => ({ id: id(), name: e.name, amount: e.amount as any, saved: true }));
        setExpenses((prev) => {
          const unsaved = (prev || []).filter((x) => !x.saved);
          const key = (o: { name: string; amount: any }) => `${(o.name || '').trim().toLowerCase()}|${Number(o.amount) || 0}`;
          const seen = new Set(fromServer.map(key));
          const mergedUnsaved = unsaved.filter((u) => !seen.has(key(u as any)));
          return [...fromServer, ...mergedUnsaved];
        });
      } catch {}
    }
    pullExpenses();
  const tid = setInterval(pullExpenses, 5000);
    return () => { cancelled = true; clearInterval(tid); };
  }, [tab, outlet, dateStr]);

  // Auto-refresh Till payments when Till tab is active
  useEffect(() => {
    if (!outlet || tab !== "till") return;
    let cancelled = false;
    async function tick() {
      try { if (!cancelled) await refreshTill(outlet as string); } catch {}
    }
    tick();
    // Faster refresh so payments appear promptly after C2B/STK confirmations
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab, outlet]);

  // Auto-refresh Summary KPIs when Summary tab is active
  useEffect(() => {
    if (!outlet || tab !== "summary") return;
    let cancelled = false;
    async function tick() {
      try {
        if (cancelled) return;
        const dateArg = summaryMode === 'previous' ? dateStr : undefined;
        await refreshPeriodAndHeader(outlet as string, dateArg, summaryMode === 'previous');
      } catch {}
    }
    tick();
    // Refresh every 3s so Till Sales (Gross) reflects new payments quickly
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab, outlet, summaryMode, dateStr]);

  // Background refresh ticker so KPIs update even when not on Summary (e.g., verified deposits processed externally)
  useEffect(() => {
    if (!outlet) return;
    let cancelled = false;
    function start() {
      const id = setInterval(async () => {
        try {
          if (cancelled) return;
          const dateArg = summaryMode === 'previous' ? dateStr : undefined;
          // Avoid duplicating the tighter 3s poll when Summary tab is open
          if (tab !== 'summary') {
            await refreshPeriodAndHeader(outlet as string, dateArg, summaryMode === 'previous');
          }
        } catch {}
      }, 6000);
      return id;
    }
    const timer = start();
    return () => { cancelled = true; clearInterval(timer); };
  }, [outlet, tab, summaryMode, dateStr]);

  // Build Stock rows whenever openingRowsRaw or catalog changes (fix race with async fetch)
  useEffect(() => {
    if (!outlet) return;

    const canonByLc: Record<string, ItemKey> = {} as any;
    (Object.keys(catalog) as ItemKey[]).forEach((k) => { canonByLc[String(k).toLowerCase()] = k; });

    const infoByKey = new Map<string, { name: string; unit: Unit }>();
    const qtyByKey = new Map<string, number>();

    const supplyInfoByKey = new Map<string, { name?: string; unit?: string }>();
    (supplyHistory || []).forEach((row) => {
      if (row.date !== stockDate) return;
      const lc = String(row.itemKey || "").toLowerCase();
      if (!supplyInfoByKey.has(lc)) supplyInfoByKey.set(lc, { name: row.name, unit: row.unit });
    });

    (openingRowsRaw || []).forEach((r) => {
      const rawKey = String(r.itemKey || "");
      const lc = rawKey.toLowerCase();
      const canon = canonByLc[lc];
      if (!canon) {
        // Skip items that are outside this attendant/assistant scope; they belong to another code.
        return;
      }
      const qty = Number(r.qty || 0);
      if (!Number.isFinite(qty) || qty < 0) return;

      const keyStr = String(canon);
      qtyByKey.set(keyStr, (qtyByKey.get(keyStr) || 0) + qty);

      if (!infoByKey.has(keyStr)) {
        const prod = catalog[canon as ItemKey];
        const supplyMeta = supplyInfoByKey.get(lc);
        const unitRaw = String(prod?.unit || r.unit || supplyMeta?.unit || "kg").toLowerCase();
        const unit: Unit = unitRaw === "pcs" ? "pcs" : "kg";
        const name = prod?.name || supplyMeta?.name || rawKey.toUpperCase();
        infoByKey.set(keyStr, { name, unit });
      }
    });

    const built: Row[] = Array.from(qtyByKey.entries()).map(([keyStr, openingQty]) => {
      const info = infoByKey.get(keyStr) || { name: keyStr.toUpperCase(), unit: "kg" as Unit };
      const key = keyStr as ItemKey;
      return {
        key,
        name: info.name,
        unit: info.unit,
        opening: openingQty,
        closing: "",
        waste: "",
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    setRows((prev) => {
      if (!prev || prev.length === 0) return built;
      const prevByKey = new Map(prev.map((r) => [r.key, r] as const));
      return built.map((b) => {
        const p = prevByKey.get(b.key);
        if (!p) return b;
        return { ...b, closing: p.closing, waste: p.waste };
      });
    });
  }, [openingRowsRaw, catalog, outlet, supplyHistory, stockDate]);

  const assistantOpeningView = useMemo(() => {
    if (!assistantMode) return [];
    const list: Array<{ key: string; name: string; unit: Unit; qty: number }> = [];
    (openingRowsRaw || []).forEach((r) => {
      const rawKey = String(r.itemKey || "");
      if (!rawKey) return;
      const qty = Number(r.qty || 0);
      if (!Number.isFinite(qty)) return;
      const prod = catalog[rawKey as ItemKey];
      const unitRaw = String(prod?.unit || r.unit || "kg").toLowerCase();
      const unit: Unit = unitRaw === "pcs" ? "pcs" : "kg";
      const name = prod?.name || rawKey.toUpperCase();
      list.push({ key: rawKey, name, unit, qty });
    });
    return list
      .filter((row) => row.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assistantMode, openingRowsRaw, catalog]);

  // Derive today supply by item (lowercased keys) from supplyHistory
  const supplyTodayLc = useMemo(() => {
    const map: Record<string, number> = {};
    try {
      (supplyHistory || []).forEach((r) => {
        if (r.date !== stockDate) return;
        const lc = String(r.itemKey || "").toLowerCase();
        const qty = Number(r.qty || 0);
        if (!Number.isFinite(qty)) return;
        map[lc] = (map[lc] || 0) + qty;
      });
    } catch {}
    return map;
  }, [supplyHistory, stockDate]);

  // Overlay already saved closing/waste from DB and lock those rows (for the same date as stock rows)
  useEffect(() => {
    if (!outlet || rows.length === 0) return;
    (async () => {
      try {
        const outletName = outlet as string;
        const j = await getJSON<{ ok: boolean; closingMap: Record<string, number>; wasteMap: Record<string, number> }>(
          `/api/attendant/closing?date=${encodeURIComponent(stockDate)}&outlet=${encodeURIComponent(outletName)}`
        );
        const c = j?.closingMap || {};
        const w = j?.wasteMap || {};
        // Lowercase views for case-insensitive matching
        const cLc: Record<string, number> = {};
        const wLc: Record<string, number> = {};
        Object.keys(c).forEach((k) => { cLc[String(k).toLowerCase()] = Number(c[k] || 0); });
        Object.keys(w).forEach((k) => { wLc[String(k).toLowerCase()] = Number(w[k] || 0); });
        const toLock: Record<string, boolean> = {};
        setRows((prev) => prev.map((r) => {
          const lc = String(r.key).toLowerCase();
          const has = Object.prototype.hasOwnProperty.call(cLc, lc) || Object.prototype.hasOwnProperty.call(wLc, lc);
          if (has) toLock[r.key] = true;
          return has ? { ...r, closing: Number(cLc[lc] ?? r.closing ?? 0), waste: Number(wLc[lc] ?? r.waste ?? 0) } : r;
        }));
        setLocked((p) => ({ ...p, ...toLock }));
        try {
          const cnt = Object.keys(cLc).length + Object.keys(wLc).length;
          setSavedClosingTodayCount(cnt);
        } catch { setSavedClosingTodayCount(0); }
      } catch {}
    })();
  }, [rows.length, outlet, stockDate]);

  // Auto-refresh saved closings on Stock tab so deletions/updates reflect without reload
  useEffect(() => {
    if (!outlet || tab !== "stock" || rows.length === 0) return;
    let cancelled = false;
    async function pollOnce() {
      try {
        const j = await getJSON<{ ok: boolean; closingMap: Record<string, number>; wasteMap: Record<string, number> }>(
          `/api/attendant/closing?date=${encodeURIComponent(stockDate)}&outlet=${encodeURIComponent(String(outlet))}`
        );
        if (!j || j.ok !== true) return;
        if (cancelled) return;
        const c = j?.closingMap || {};
        const w = j?.wasteMap || {};
        const cLc: Record<string, number> = {};
        const wLc: Record<string, number> = {};
        Object.keys(c).forEach((k) => { cLc[String(k).toLowerCase()] = Number(c[k] || 0); });
        Object.keys(w).forEach((k) => { wLc[String(k).toLowerCase()] = Number(w[k] || 0); });

        setRows((prev) => {
          const next = prev.map((r) => {
            const lc = String(r.key).toLowerCase();
            const has = Object.prototype.hasOwnProperty.call(cLc, lc) || Object.prototype.hasOwnProperty.call(wLc, lc);
            if (has) {
              // Only overlay if row is already locked OR there is no unsaved input
              const isLocked = !!locked[r.key];
              const hasUnsaved = !isLocked && (toNum(r.closing) > 0 || toNum(r.waste) > 0);
              if (isLocked || !hasUnsaved) {
                return { ...r, closing: Number(cLc[lc] ?? r.closing ?? 0), waste: Number(wLc[lc] ?? r.waste ?? 0) };
              }
              return r;
            } else {
              // If server no longer has this row and it was locked before, clear it
              if (locked[r.key]) {
                return { ...r, closing: "", waste: "" };
              }
              return r;
            }
          });
          return next;
        });

        setLocked((prevLocked) => {
          const next: Record<string, boolean> = { ...prevLocked };
          for (const r of rows) {
            const lc = String(r.key).toLowerCase();
            const has = Object.prototype.hasOwnProperty.call(cLc, lc) || Object.prototype.hasOwnProperty.call(wLc, lc);
            if (has) next[r.key] = true; else delete next[r.key];
          }
          return next;
        });
      } catch {}
    }
    // initial tick and interval
    pollOnce();
    const id = setInterval(pollOnce, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab, outlet, stockDate, rows.length, locked]);


  /** ===== Client-side expected totals (unchanged) ===== */
  const sellPrice = (k: ItemKey) => Number(catalog[k]?.sellPrice || 0);
  const computed = useMemo(() => {
    // Only count submitted (locked) rows towards expected sales until the attendant submits
    const perItem = rows.map(r => {
      const isLocked = !!locked[r.key];
      const closing = isLocked ? toNum(r.closing) : 0;
      const waste = isLocked ? toNum(r.waste) : 0;
      const soldQty = isLocked ? Math.max(0, r.opening - closing - waste) : 0;
      const expectedKsh = soldQty * sellPrice(r.key);
      return { ...r, soldQty, expectedKsh };
    });
    const expectedKsh = perItem.reduce((a, r) => a + r.expectedKsh, 0);
    const depositedKsh = depositsFromServer
      .filter((d:any) => (d.status || "PENDING") === "VALID")
      .reduce((a: number, d: any) => a + Number(d.amount || 0), 0);
    // Use only saved expenses for projections to avoid over/under counting drafts
    const expensesKsh = expenses.filter(e => e.saved).reduce((a, e) => a + toNum(e.amount), 0);
    const projectedTill = expectedKsh - depositedKsh - expensesKsh;
    const counted = toNum(countedTill);
    const varianceKsh = counted - projectedTill;
    return { perItem, expectedKsh, depositedKsh, expensesKsh, projectedTill, counted, varianceKsh };
  }, [rows, locked, depositsFromServer, expenses, countedTill, catalog]);

  /** ===== Handlers ===== */
  const setClosing = (key: ItemKey, v: number | string | "") => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, closing: v } : r));
    setInvalidByKey(prev => { const n = { ...prev }; delete (n as any)[key]; return n; });
  };
  const setWaste   = (key: ItemKey, v: number | string | "") => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, waste: v } : r));
    setInvalidByKey(prev => { const n = { ...prev }; delete (n as any)[key]; return n; });
  };

  // deposits
  const addDeposit = () => setDeposits(prev => [...prev, { id: id(), code: "", amount: "", note: "" }]);
  const rmDeposit  = (did: string) => setDeposits(prev => prev.filter(d => d.id !== did));
  const upDeposit  = (did: string, patch: Partial<Deposit>) =>
    setDeposits(prev => prev.map(d => {
      const next = d.id === did ? { ...d, ...patch } : d;
      // When a full M-Pesa SMS is pasted into note, try to extract amount and code
      if (d.id === did && patch.note && /M-?Pesa|Ksh|KES|Confirmed/i.test(patch.note)) {
        try {
          const m = /Ksh\s*([0-9,]+)\b.*?([A-Z0-9]{10,})/i.exec(patch.note);
          if (m) {
            const amt = Number(m[1].replace(/,/g, ""));
            const ref = m[2];
            const amtEmpty = typeof next.amount !== "number" || !isFinite(next.amount);
            if (amtEmpty) (next as any).amount = amt;
            if (!next.code) (next as any).code = ref;
          }
        } catch {}
      }
      return next;
    }));

  // expenses
  const addExpense = () => setExpenses(prev => [...prev, { id: id(), name: "", amount: "" }]);
  const rmExpense  = (eid: string) => setExpenses(prev => prev.filter(e => e.id !== eid));
  const upExpense  = (eid: string, patch: Partial<{name: string; amount: number | string | ""}>) =>
    setExpenses(prev => prev.map(e => e.id === eid ? { ...e, ...patch } : e));

  // stock submit: submit a single row, then rotate later when ready
  async function submitRow(r: Row) {
    if (!outlet) return;
    try {
      // Pass the specific stock date; after rotation the UI may be on tomorrow
      await postJSON("/api/attendant/closing/item", { date: stockDate, itemKey: r.key, closingQty: toNum(r.closing), wasteQty: toNum(r.waste) });
      setLocked(prev => ({ ...prev, [r.key]: true }));
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Failed to submit";
      notifyToast(msg);
    }
  }

  const submitStock = async () => {
    if (!outlet) return;
    setSubmitError(null);
    setSubmittingStock(true);

  const closingMap: Record<string, number> = {};
  const wasteMap: Record<string, number> = {};
    rows.forEach(r => { closingMap[r.key] = toNum(r.closing); wasteMap[r.key] = toNum(r.waste); });

    // Pre-submit checks: warn if any item with opening > 0 has no closing entered (assumed 0),
    // and warn if no expenses have been entered for today.
    try {
      const missingClosings = rows
        .filter(r => Number(r.opening) > 0 && toNum(r.closing) <= 0)
        .map(r => `${r.name}`);
      const hasAnyExpense = expenses.some(e => toNum(e.amount) > 0 && (e.name || "").trim() !== "");
      const messages: string[] = [];
      if (missingClosings.length > 0) {
        messages.push(`Missing closing for ${missingClosings.length} item(s):\n- ${missingClosings.slice(0, 10).join("\n- ")}${missingClosings.length > 10 ? "\n…" : ""}`);
      }
      if (!hasAnyExpense) {
        messages.push("No expenses entered for today. It will be assumed to be Ksh 0.");
      }
      if (messages.length > 0) {
  const ok = confirmSync(`${messages.join("\n\n")}\n\nProceed and submit with these values assumed as 0?`);
        if (!ok) return;
      }
    } catch {}

    // Persist remaining unsaved rows in one shot for convenience
    try {
      await postJSON("/api/attendant/closing", { outlet, date: stockDate, closingMap, wasteMap });
    } catch (e: any) {
      const raw = typeof e?.message === "string" ? e.message : "Failed to submit stock";
      let msg = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const v = Array.isArray(parsed.violations) ? parsed.violations : [];
          if (v.length > 0) {
            const map: Record<ItemKey, string> = {} as any;
            for (const it of v) {
              const k = String(it?.itemKey || '').toLowerCase();
              const r = rows.find(x => String(x.key).toLowerCase() === k);
              if (r) map[r.key] = String(it?.message || parsed.error || 'Invalid closing');
            }
            if (Object.keys(map).length > 0) setInvalidByKey(map);
            msg = String(parsed.error || msg || 'Validation failed');
          }
        }
      } catch {}
  notifyToast(msg);
      setSubmitError(msg || "Submission failed");
      setSubmittingStock(false);
      // Do not proceed to period rotation or summary when stock submission fails
      return;
    }

    // snapshot for next period
    const openingSnapshot: Record<string, number> = {};
    (openingRowsRaw || []).forEach(r => { openingSnapshot[r.itemKey] = (openingSnapshot[r.itemKey] || 0) + Number(r.qty || 0); });

    const pricebookSnapshot: Record<string, { sellPrice: number; active: boolean }> = {};
    (Object.keys(catalog) as ItemKey[]).forEach(k => {
      const p = catalog[k];
      pricebookSnapshot[k] = { sellPrice: Number(p.sellPrice || 0), active: !!p.active };
    });

    let closeCount = 1;
    let rotated = false;
    let rotatedDate: string | undefined;
    let rotatedTomorrow: string | undefined;
    let rotatedPhase: "none" | "first" | "second" = "none";
    let seededTodayCount = 0;
    let seededTomorrowCount = 0;
    let seededTodayKeys: string[] = [];
    let seededTomorrowKeys: string[] = [];
    try {
      const res = await postJSON<{ ok: boolean; date?: string; tomorrow?: string; closeCount?: number; rotated?: boolean; details?: { phase?: string; seededTodayCount?: number; seededTomorrowCount?: number; seededTodayKeys?: string[]; seededTomorrowKeys?: string[] } }>("/api/period/start", { outlet, openingSnapshot, pricebookSnapshot });
      closeCount = Number(res?.closeCount || 1);
      rotated = !!res?.rotated;
      rotatedDate = typeof res?.date === 'string' ? res.date : undefined;
      rotatedTomorrow = typeof res?.tomorrow === 'string' ? res.tomorrow : undefined;
      rotatedPhase = (res?.details?.phase === 'first' || res?.details?.phase === 'second') ? (res.details.phase as any) : 'none';
      seededTodayCount = Number(res?.details?.seededTodayCount || 0);
      seededTomorrowCount = Number(res?.details?.seededTomorrowCount || 0);
      seededTodayKeys = Array.isArray(res?.details?.seededTodayKeys) ? (res!.details!.seededTodayKeys as any) : [];
      seededTomorrowKeys = Array.isArray(res?.details?.seededTomorrowKeys) ? (res!.details!.seededTomorrowKeys as any) : [];
    } catch (e: any) {
      // We no longer forbid third+ submissions; surface other errors only
      const msg = typeof e?.message === 'string' ? e.message : '';
      if (msg) { notifyToast(msg); setSubmitError(msg); setSubmittingStock(false); return; }
    }

    // Fire low-stock notifications (non-blocking)
    try {
      await postJSON("/api/notify/low-stock", { outlet, closingMap });
    } catch {}

    // Persist counted till to DB (if entered)
    try {
      if (countedTill !== "") {
        await postJSON("/api/tillcount", { date: dateStr, outlet, counted: toNum(countedTill) });
      }
    } catch {}

  setSubmitted(true);
  setTab("summary");
  if (rotated && closeCount >= 2) {
    // End-of-day rotation: show previous and advance stock to tomorrow
    setSummaryMode("previous");
    try { window.localStorage.setItem(summaryKeyFor(dateStr, outlet), 'previous'); } catch {}
    try { window.localStorage.setItem(rotationBannerKeyFor(dateStr, outlet), 'show'); setShowRotationBanner(true); } catch {}
    // Show the closed day's results in Summary (use server-provided date if available)
  await refreshPreviousWithRetry(outlet, rotatedDate || dateStr);
    // Show confirmation toast
    if (seededTomorrowCount > 0) setToastMsg(`Seeded tomorrow's opening for ${seededTomorrowCount} item(s).`);
  } else {
    // Midday period switch: stay on current day; keep Summary on current
    setSummaryMode("current");
    try { window.localStorage.setItem(summaryKeyFor(dateStr, outlet), 'current'); } catch {}
  await refreshPeriodAndHeader(outlet, undefined);
    if (rotated && seededTodayCount > 0) setToastMsg(`Reset today's opening for ${seededTodayCount} item(s).`);
  }
    // refresh closing/waste reads from DB for consistency
  try { await getJSON(`/api/attendant/closing?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`); } catch {}
    // Clear input buffers for deposits and expenses for the new period
    setDeposits([]);
    setExpenses([]);
  // Advance stock UI only if this was the second close for the day
    setRows([]);
    setLocked({});
  setInvalidByKey({} as any);
    if (rotated && closeCount >= 2) {
      const tomorrow = rotatedTomorrow || nextDate(dateStr);
      setStockDate(tomorrow);
      try {
        if ((seededTomorrowCount > 0 || rotatedPhase === 'second') && seededTomorrowKeys.length > 0) {
          // Locally apply new opening rows from our submitted closings for the seeded keys
          const nextRows = (seededTomorrowKeys as string[])
            .map((k) => {
              const key = k as ItemKey;
              const qty = Number((closingMap as any)[key] ?? 0);
              if (!Number.isFinite(qty) || qty <= 0) return null;
              return { itemKey: key, qty } as { itemKey: ItemKey; qty: number };
            })
            .filter(Boolean) as Array<{ itemKey: ItemKey; qty: number }>;
          if (nextRows.length > 0) {
            setOpeningRowsRaw(nextRows);
          } else {
            const r1 = await getJSON<{ ok: boolean; rows: Array<{ itemKey: ItemKey; qty: number }> }>(`/api/stock/opening-effective?date=${encodeURIComponent(tomorrow)}&outlet=${encodeURIComponent(String(outlet))}`);
            setOpeningRowsRaw(r1.rows || []);
          }
        }
      } catch { setOpeningRowsRaw([]); }
    } else {
      // Either midday rotation (first close) or third+ submission: stay on same day
      try {
        if ((seededTodayCount > 0 || rotatedPhase === 'first') && seededTodayKeys.length > 0) {
          const nextRows = (seededTodayKeys as string[])
            .map((k) => {
              const key = k as ItemKey;
              const qty = Number((closingMap as any)[key] ?? 0);
              if (!Number.isFinite(qty) || qty <= 0) return null;
              return { itemKey: key, qty } as { itemKey: ItemKey; qty: number };
            })
            .filter(Boolean) as Array<{ itemKey: ItemKey; qty: number }>;
          if (nextRows.length > 0) {
            setOpeningRowsRaw(nextRows);
          } else {
            const r1 = await getJSON<{ ok: boolean; rows: Array<{ itemKey: ItemKey; qty: number }> }>(`/api/stock/opening-effective?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
            setOpeningRowsRaw(r1.rows || []);
          }
        }
      } catch { setOpeningRowsRaw([]); }
    }
    try {
      // Refresh supply/history only if rotation happened
      if (rotated) {
        const r2 = await getJSON<{ ok: boolean; rows: Array<{ date: string; itemKey: string; name: string; qty: number; unit: string }> }>(`/api/supply/history?days=7&sort=date_desc`);
        setSupplyHistory((r2 as any).rows || []);
      }
    } catch { if (rotated) setSupplyHistory([]); }
    setSubmittingStock(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitDeposits = async () => {
    if (!outlet) return;
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
    // refresh from DB and clear input
    try {
  const r = await getJSON<{ ok: boolean; rows: Array<{ code?: string; amount: number; note?: string; status?: "VALID"|"PENDING"|"INVALID"; createdAt?: string }> }>(`/api/deposits?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
      setDepositsFromServer(r.rows || []);
    } catch {}
    setDeposits([]);
  };

  const submitExpenses = async () => {
    if (!outlet) return;
    // Submit all unsubmitted expenses one-by-one to avoid wiping submitted ones
    const unsaved = expenses.filter(e => !e.saved && (e.name || "").trim() !== "" && toNum(e.amount) > 0);
    for (const e of unsaved) {
      try {
        await postJSON("/api/expenses/item", { name: e.name.trim(), amount: toNum(e.amount) });
        setExpenses(prev => prev.map(x => x.id === e.id ? { ...x, saved: true } : x));
      } catch (e: any) {
        const msg = typeof e?.message === "string" ? e.message : "Failed to submit expense";
        notifyToast(msg);
      }
    }
    if (outlet) await refreshPeriodAndHeader(outlet);
  };

  async function submitExpenseRow(eid: string) {
    const e = expenses.find(x => x.id === eid);
    if (!e || !outlet) return;
    try {
      await postJSON("/api/expenses/item", { name: (e.name || "").trim(), amount: toNum(e.amount) });
      setExpenses(prev => prev.map(x => x.id === eid ? { ...x, saved: true } : x));
      await refreshPeriodAndHeader(outlet);
    } catch {}
  }

  async function refreshPeriodAndHeader(outletName: string, summaryDate?: string, periodPrevious?: boolean) {
    try {
      const pa = await getJSON<{ ok: boolean; active: { periodStartAt: string } | null }>(`/api/period/active?outlet=${encodeURIComponent(outletName)}`);
      const startAt = pa?.active?.periodStartAt ?? null;
      setPeriodStartAt(startAt);
      setActiveFrom(startAt);
    } catch { setPeriodStartAt(null); }

    try {
      const { totals, assistant } = await fetchHeaderTotals(outletName, summaryDate, periodPrevious);
      setKpi({
        weightSales: Number(totals.weightSales ?? 0),
        expenses: Number(totals.expenses ?? 0),
        todayTotalSales: Number(totals.todayTotalSales ?? 0),
        tillSalesNet: Number(totals.netTill ?? 0),
        tillSalesGross: Number(totals.todayTillSales ?? 0),
        verifiedDeposits: Number(totals.verifiedDeposits ?? 0),
        amountToDeposit: Number(totals.amountToDeposit ?? 0),
        carryoverPrev: Number(totals.carryoverPrev ?? 0),
        openingValue: Number((totals as any).openingValue ?? 0),
      });
      setAssistantInsights(assistant ?? null);
      if (assistant) {
        setIsAssistantRole(true);
        setIsGeneralDeposit(true);
      }
    } catch {
      setAssistantInsights(null);
      // Conservative fallback:
      // - If period is active OR we have any saved activity, estimate ONLY from submitted (locked) rows.
      // - Otherwise, show zeros to avoid inflating sales before submission.
      const isActive = !!periodStartAt;
      const hasAnyActivity = (savedClosingTodayCount > 0) || (depositsFromServer.length > 0) || (expenses.some(e => e.saved)) || (toNum(countedTill) > 0);
      if (isActive || hasAnyActivity) {
        const expectedFromLocked = rows
          .filter(r => !!locked[r.key])
          .reduce((a, r) => a + Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)) * sellPrice(r.key), 0);
        const expensesSaved = expenses.filter(e => e.saved).reduce((a, e) => a + toNum(e.amount), 0);
        const todayTotal = expectedFromLocked - expensesSaved;
        setKpi({
          weightSales: expectedFromLocked,
          expenses: expensesSaved,
          todayTotalSales: todayTotal,
          tillSalesNet: 0,
          tillSalesGross: 0,
          verifiedDeposits: 0,
          amountToDeposit: Math.max(0, todayTotal),
          carryoverPrev: 0,
          openingValue: 0,
        });
      } else {
        setKpi({
          weightSales: 0,
          expenses: 0,
          todayTotalSales: 0,
          tillSalesNet: 0,
          tillSalesGross: 0,
          verifiedDeposits: 0,
          amountToDeposit: 0,
          carryoverPrev: 0,
          openingValue: 0,
        });
      }
    }
  }

  // Small helper to fetch header totals with parameters
  async function fetchHeaderTotals(outletName: string, summaryDate?: string, periodPrevious?: boolean): Promise<{
    totals: {
      todayTillSales?: number; verifiedDeposits?: number; netTill?: number; expenses?: number; weightSales?: number; todayTotalSales?: number; amountToDeposit?: number; carryoverPrev?: number; openingValue?: number;
    };
    assistant?: {
      expected: number;
      recommendedNow: number;
      depositedSoFar: number;
      salesValue: number;
      expensesValue: number;
      periodState: string;
      warnings?: string[];
      breakdown?: Array<{ productKey: string; productName: string; salesUnits: number; salesValue: number; price: number }>;
    };
  }> {
  const base = `/api/metrics/header?outlet=${encodeURIComponent(outletName)}`;
  const att = attendantCode ? `&attendant=${encodeURIComponent(attendantCode)}` : "";
  const url = `${base}${att}${summaryDate ? `&date=${encodeURIComponent(summaryDate)}` : ""}${periodPrevious ? `&period=previous` : ""}`;
    const h = await getJSON<{ ok: boolean; totals?: { todayTillSales?: number; verifiedDeposits?: number; netTill?: number; expenses?: number; weightSales?: number; todayTotalSales?: number; amountToDeposit?: number; carryoverPrev?: number; openingValue?: number }; assistant?: any }>(url);
    if (!h || h.ok !== true || !h.totals) throw new Error("bad header response");
    return { totals: h.totals as any, assistant: h.assistant };
  }

  // After rotation to Previous, retry briefly if snapshot reads are momentarily lagging
  async function refreshPreviousWithRetry(outletName: string, closedDate: string) {
    const attempts = [0, 250, 500];
    let last: any = null;
    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, attempts[i]));
      try {
        const { totals } = await fetchHeaderTotals(outletName, closedDate, true);
        last = totals;
        // Heuristic: if all of these are zero, it might be before snapshot is visible; retry
        const looksEmpty = Number(totals.weightSales || 0) === 0 && Number(totals.expenses || 0) === 0 && Number(totals.verifiedDeposits || 0) === 0;
        if (!looksEmpty) {
          setKpi({
            weightSales: Number(totals.weightSales || 0),
            expenses: Number(totals.expenses || 0),
            todayTotalSales: Number(totals.todayTotalSales || 0),
            tillSalesNet: Number(totals.netTill || 0),
            tillSalesGross: Number(totals.todayTillSales || 0),
            verifiedDeposits: Number(totals.verifiedDeposits || 0),
            amountToDeposit: Number(totals.amountToDeposit || 0),
            carryoverPrev: Number(totals.carryoverPrev || 0),
            openingValue: Number((totals as any).openingValue || 0),
          });
          return;
        }
      } catch {}
    }
    // Commit the last totals even if empty so UI updates deterministically
    if (last) {
      setKpi({
        weightSales: Number(last.weightSales || 0),
        expenses: Number(last.expenses || 0),
        todayTotalSales: Number(last.todayTotalSales || 0),
        tillSalesNet: Number(last.netTill || 0),
        tillSalesGross: Number(last.todayTillSales || 0),
        verifiedDeposits: Number(last.verifiedDeposits || 0),
        amountToDeposit: Number(last.amountToDeposit || 0),
        carryoverPrev: Number(last.carryoverPrev || 0),
        openingValue: Number((last as any).openingValue || 0),
      });
    }
  }

  async function refreshTill(outletName: string) {
    try {
      const periodQs = summaryMode === 'previous' ? `&period=previous&date=${encodeURIComponent(dateStr)}` : '';
      // Always scope Till Payments to the logged-in outlet
  const base = `/api/payments/till?outlet=${encodeURIComponent(outletName)}`;
  const sortQs = `&sort=${encodeURIComponent(tillSort)}`;
  const res = await getJSON<{ ok: boolean; total: number; rows: TillPaymentRow[] }>(`${base}${periodQs}${sortQs}`);
      setTillRows(res.rows || []);
      setTillTotal(res.total || 0);
    } catch {
      setTillRows([]); setTillTotal(0);
    }
  }

  /** ===== Logout ===== */
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    // Also clear client-only hints
    try { sessionStorage.removeItem("attendant_code"); } catch {}
    window.location.href = "/attendant";
  };

  /** ===== Guard ===== */
  useEffect(() => {
    if (outlet === null) {
      const t = setTimeout(() => {
        if (outlet === null) window.location.href = "/attendant";
      }, 3000); // allow enough time for server calls to resolve
      return () => clearTimeout(t);
    }
  }, [outlet]);

  // Ensure assistants avoid Till tab (deposits go straight to General)
  useEffect(() => {
    if (!assistantMode) return;
    if (tab === "till") setTab("deposits");
  }, [assistantMode, tab]);

  if (!outlet) {
    return (
      <main className="mobile-container sticky-safe p-6">
        <h1 className="text-lg font-semibold">Attendant Dashboard</h1>
        <p className="text-sm text-gray-600 mt-2">
          Resolving your outlet from the code… If it doesn’t redirect, go back to{" "}
          <a className="underline" href="/attendant">Attendant Login</a>.
        </p>
      </main>
    );
  }


  return (
    <main className="mobile-container sticky-safe p-6 max-w-7xl mx-auto">
      {toastMsg && (
        <div className="mb-3 inline-flex items-start gap-3 rounded-2xl border px-3 py-2 text-sm bg-green-50 border-green-200 text-green-800 w-full">
          <div>{toastMsg}</div>
          <button className="ml-auto text-xs underline decoration-dotted" onClick={() => setToastMsg(null)}>Dismiss</button>
        </div>
      )}
      {/* Header */}
  <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Attendant Dashboard</h1>
          <p className="text-sm text-gray-600">
            Outlet: <span className="font-medium">{outlet}</span>
            {attendantName && (
              <>
                <span className="mx-2 text-gray-400">•</span>
                Attendant: <span className="font-medium">{attendantName}</span>
              </>
            )}
            {periodStartAt ? (
              <span className="ml-2 inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-green-50 border-green-200 text-green-700">
                Active period since {new Date(periodStartAt).toLocaleTimeString(undefined, { timeZone: "Africa/Nairobi" })}
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-yellow-50 border-yellow-200 text-yellow-700">
                Awaiting Stock Submit to start new period
              </span>
            )}
            {assistantMode && (
              <span className="ml-2 inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-blue-50 border-blue-200 text-blue-800" title="Assistant mode: deposits go to General till; Till Sales are hidden.">
                Assistant mode • Deposit to GENERAL
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 mobile-scroll-x">
          <input
            className="input-mobile border rounded-xl p-2 text-sm opacity-80"
            type="date"
            value={dateStr}
            disabled   // <-- locked to today
          />
          {/* Simplified: removed Refresh Admin */}
          <button
            onClick={logout}
            className="btn-mobile px-3 py-2 rounded-xl border text-sm"
            title="Logout"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mobile-scroll-x mb-4 flex flex-wrap gap-2">
        <TabBtn active={tab==="stock"} onClick={()=>setTab("stock")}>Stock</TabBtn>
        <TabBtn active={tab==="products"} onClick={()=>setTab("products")}>Products</TabBtn>
        <TabBtn active={tab==="supply"} onClick={()=>setTab("supply")}>Supply</TabBtn>
        <TabBtn active={tab==="deposits"} onClick={()=>setTab("deposits")}>Deposits</TabBtn>
        <TabBtn active={tab==="expenses"} onClick={()=>setTab("expenses")}>Expenses</TabBtn>
        {!assistantMode && <TabBtn active={tab==="till"} onClick={()=>setTab("till")}>Till Payments</TabBtn>}
        <TabBtn active={tab==="summary"} onClick={()=>setTab("summary")}>Summary</TabBtn>
      </nav>

      {/* Ensure assistants never land on Till tab */}
  {/* handled via useEffect above to avoid side-effects in render */}
  {null}

      {/* ===== PRODUCTS (Assigned + Prices) ===== */}
      {tab === "products" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Products & Prices</h2>
            {productsLoading && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}
          </div>
          <div className="text-sm text-gray-600 mb-3">
            {productsOutlet ? (
              <>
                Assigned to outlet: <span className="font-medium">{productsOutlet}</span>
              </>
            ) : (
              <>Assigned products for your outlet</>
            )}
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Product</th>
                  <th>Key</th>
                  <th>Price (Ksh)</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {productsError && (
                  <tr>
                    <td className="py-2 text-red-700" colSpan={4}>{productsError}</td>
                  </tr>
                )}
                {!productsError && products.length === 0 && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={4}>No products assigned.</td>
                  </tr>
                )}
                {products.map((p, i) => (
                  <tr key={`${p.key}-${i}`} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{p.key}</code></td>
                    <td>Ksh {fmt(Number(p.price) || 0)}</td>
                    <td className="text-xs text-gray-500">{p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 mt-3">Prices auto-refresh every 5s while this tab is open.</p>
        </section>
      )}

      {/* ===== STOCK ===== */}
      {tab === "stock" && (
        <>
          <section className="rounded-2xl border p-4 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Closing & Waste — {stockDate}</h2>
              {(() => { const unsaved = rows.filter(r => !locked[r.key] && (toNum(r.closing) > 0 || toNum(r.waste) > 0)).length; return unsaved > 0 ? (
                <span className="inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-yellow-50 border-yellow-200 text-yellow-700">
                  Unsaved: {unsaved}
                </span>
              ) : null; })()}
            </div>
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Item</th>
                    <th>Opening</th>
                    <th>Closing</th>
                    <th>Waste</th>
                    <th>Sold</th>
                    <th>Expected (Ksh)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td className="py-2 text-gray-500" colSpan={7}>No opening stock found from Supplier for this outlet/day.</td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.key} className={"border-b " + (invalidByKey[r.key] ? "bg-red-50/40" : "") }>
                      <td className="py-2">{r.name}</td>
                      <td>
                        <div>{fmt(r.opening)} {r.unit}</div>
                        {(() => {
                          const lc = String(r.key).toLowerCase();
                          const y = Number(prevClosingLc[lc] || 0);
                          const t = Number(supplyTodayLc[lc] || 0);
                          const eff = y + t;
                          if (eff <= 0) return null;
                          const delta = Math.abs(eff - Number(r.opening || 0));
                          const warn = delta > 0.01;
                          const title = `Item: ${r.key}\nYesterday (${prevDate(stockDate)}): ${fmt(y)} ${r.unit}\nToday supply (${stockDate}): ${fmt(t)} ${r.unit}\n= OpeningEff: ${fmt(eff)} ${r.unit}\nDisplayed Opening: ${fmt(Number(r.opening || 0))} ${r.unit}${warn ? `\nΔ: ${fmt(delta)} ${r.unit}` : ''}`;
                          return (
                            <div
                              className={"text-[10px] mt-0.5 " + (warn ? "text-amber-600" : "text-gray-500")}
                              title={title}
                            >
                              OpeningEff = {fmt(y)} + {fmt(t)}{warn ? " • check" : ""}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <input
                          className={"input-mobile border rounded-xl p-2 w-28 " + (invalidByKey[r.key] ? "border-red-400" : "")}
                          type="number"
                          min={0}
                          step={r.unit === "kg" ? 0.01 : 1}
                          value={r.closing}
                          onChange={(e)=>setClosing(r.key, e.target.value)}
                          placeholder={`0 ${r.unit}`}
                          disabled={!!locked[r.key]}
                        />
                        {invalidByKey[r.key] && (
                          <div className="text-[11px] text-red-700 mt-1">{invalidByKey[r.key]}</div>
                        )}
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
                          <button className="btn-mobile text-xs border rounded-xl px-2 py-1"
                            onClick={()=>{
                              const v = askWaste(r.unit, r.waste);
                              if (v !== null) setWaste(r.key, v);
                            }}
                            disabled={!!locked[r.key]}
                          >
                            {toNum(r.waste) > 0 ? "Edit" : "+ Add Waste"}
                          </button>
                          {toNum(r.waste) > 0 && (
                            <button className="btn-mobile text-xs border rounded-xl px-2 py-1" onClick={()=>setWaste(r.key, "")} disabled={!!locked[r.key]}>Clear</button>
                          )}
                        </div>
                      </td>
                      <td className="font-medium">
                        {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)))} {r.unit}
                      </td>
                      <td className="font-medium">
                        Ksh {fmt(Math.max(0, r.opening - toNum(r.closing) - toNum(r.waste)) * (catalog[r.key]?.sellPrice ?? 0))}
                      </td>
                      <td>
                        {locked[r.key] ? (
                          <span className="text-green-700 text-xs">Submitted</span>
                        ) : (
                          <button className="btn-mobile text-xs border rounded-xl px-2 py-1" onClick={()=>submitRow(r)}>Submit</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="py-2 font-semibold" colSpan={6}>Total Expected</td>
                    <td className="font-semibold">Ksh {fmt(computed.expectedKsh)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Submit button after stock table (mobile sticky bar for reach). Always active so attendants can finalize at different times. */}
          <div className="mb-8">
            {submitError && (
              <div className="mb-3 inline-flex items-start gap-3 rounded-2xl border px-3 py-2 text-sm bg-red-50 border-red-300 text-red-700 w-full">
                <div>
                  {submitError}
                </div>
                <button
                  className="ml-auto text-xs underline decoration-dotted"
                  onClick={()=>setSubmitError(null)}
                >Dismiss</button>
              </div>
            )}
            <div className="hidden sm:block">
              <button onClick={submitStock} disabled={submittingStock} className="px-4 py-2 rounded-2xl bg-black text-white disabled:opacity-50 disabled:cursor-not-allowed">
                {submittingStock ? "Submitting…" : "Submit & Start New Period"}
              </button>
              {submitted && (
                <span className="ml-3 text-green-700 text-sm align-middle">Submitted. New trading period started.</span>
              )}
            </div>
            <div className="sm:hidden sticky-save-bottom">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/80">Stock ready?</span>
                <button onClick={submitStock} disabled={submittingStock} className="px-4 py-2 rounded-xl bg-white text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                  {submittingStock ? "Submitting…" : "Submit & Start"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== SUPPLY ===== */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Supply (Opening Stock) — {stockDate}</h2>
            <span className="text-xs text-gray-600">Read-only • Disputes go to Supervisor</span>
          </div>
          <div className="table-wrap">
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
                {(openingRowsRaw.filter(r => {
                  const key = r.itemKey as any as ItemKey;
                  return !!catalog[key];
                })).length === 0 && (
                  <tr><td className="py-3 text-gray-500" colSpan={4}>
                    No opening stock captured for today yet. Opening will start from yesterday's closing plus any new deliveries.
                  </td></tr>
                )}
                {openingRowsRaw.filter(r => {
                  const key = r.itemKey as any as ItemKey;
                  return !!catalog[key];
                }).map((r, i) => (
                  <tr key={`${r.itemKey}-${i}`} className="border-b">
                    <td className="py-2">{catalog[(r.itemKey as any as ItemKey)]?.name ?? r.itemKey.toUpperCase()}</td>
                    <td>{fmt(r.qty)}</td>
                    <td>{catalog[(r.itemKey as any as ItemKey)]?.unit ?? "kg"}</td>
                    <td>
                      <button className="btn-mobile text-xs border rounded-lg px-2 py-1" onClick={()=>{
                        const reason = promptSync(`Raise a dispute for ${catalog[(r.itemKey as any as ItemKey)]?.name ?? r.itemKey.toUpperCase()} (qty ${r.qty}). Describe the issue:`, "") || "";
                        if (!reason) return;
                        notifyToast("Dispute submitted to Supervisor.");
                      }}>
                        Raise Dispute
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Compact history (last 7 days) */}
          <div className="mt-6">
            <h3 className="font-semibold mb-2 text-sm">Recent Supply (last 7 days)</h3>
            <div className="table-wrap">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Date</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {supplyHistory.length === 0 && (
                    <tr><td className="py-2 text-gray-500" colSpan={4}>No recent records.</td></tr>
                  )}
                  {supplyHistory.slice(0, 20).map((r, i) => (
                    <tr key={`${r.date}-${r.itemKey}-${i}`} className="border-b">
                      <td className="py-2">{r.date}</td>
                      <td>{r.name}</td>
                      <td>{fmt(r.qty)}</td>
                      <td>{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ===== DEPOSITS ===== */}
      {tab === "deposits" && (
        <section className="rounded-2xl border p-4">
          {/* Quick STK Deposit card (M-Pesa Express) */}
          <QuickStkDeposit
            attendantCode={attendantCode}
            generalDepositMode={assistantMode}
            outletCode={outletCodeState ?? (typeof outlet === 'string' ? outlet : 'GENERAL')}
            defaultPhone={attendantPhone ?? undefined}
            attendantName={attendantName ?? undefined}
            defaultAmount={Number(kpi.amountToDeposit) || null}
            onSuccessAction={async () => {
              if (!outlet) return;
              // Show a small toast while we refresh the dashboard data
              try {
                setToastMsg("Refreshing dashboard…");
                // Refresh header totals (KPIs)
                try { setRefreshingKpi(true); await refreshPeriodAndHeader(outlet); } catch {} finally { setRefreshingKpi(false); }
                // Refresh deposits list for this date/outlet
                try {
                  const r = await getJSON<{ ok: boolean; rows: Array<{ code?: string; amount: number; note?: string; status?: string; createdAt?: string }> }>(`/api/deposits?date=${encodeURIComponent(dateStr)}&outlet=${encodeURIComponent(String(outlet))}`);
                  setDepositsFromServer((r.rows || []) as any);
                } catch {}
                // Refresh till payments
                try { await refreshTill(outlet); } catch {}
              } finally {
                // Clear the toast after a short delay so the user sees the message
                setTimeout(() => setToastMsg(null), 800);
              }
            }}
          />
          {assistantMode && assistantInsights && (
            <p className="mt-3 text-xs text-blue-700 bg-blue-50/70 border border-blue-200 rounded-xl px-3 py-2">
              Recommended deposit now: <span className="font-semibold">Ksh {fmt(assistantInsights.recommendedNow)}</span>. Sales {fmt(assistantInsights.salesValue)} - Expenses {fmt(assistantInsights.expensesValue)}.
            </p>
          )}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deposits (M-Pesa)</h3>
          </div>

          {/* Server-verified deposits for today */}
          <div className="table-wrap mt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Time</th>
                  <th>Amount</th>
                  <th>Code</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {depositsFromServer.length === 0 && (
                  <tr><td className="py-2 text-gray-500" colSpan={4}>No deposits recorded yet today.</td></tr>
                )}
                {depositsFromServer.map((d, i)=>(
                  <tr key={i} className="border-b">
                    <td className="py-2">{d.createdAt ? new Date(d.createdAt).toLocaleTimeString() : "—"}</td>
                    <td>Ksh {fmt(Number(d.amount) || 0)}</td>
                    <td>{d.code || "—"}</td>
                    <td><StatusPill status={(d.status as any) || "PENDING"} /></td>
                  </tr>
                ))}
              </tbody>
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
          <div className="table-wrap mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b"><th className="py-2">Name</th><th>Amount (Ksh)</th><th></th></tr>
              </thead>
              <tbody>
                {expenses.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={3}>No expenses.</td></tr>}
                {expenses.map((e)=>(
                  <tr key={e.id} className="border-b">
                    <td className="py-2">
                      <input className="input-mobile border rounded-xl p-2 w-44" placeholder="e.g. Sharpen"
                        value={e.name} onChange={(ev)=>upExpense(e.id,{name:ev.target.value})}/>
                    </td>
                    <td>
                      <input className="input-mobile border rounded-xl p-2 w-32" type="number" min={0} step={1} placeholder="Ksh"
                        value={e.amount} onChange={(ev)=>upExpense(e.id,{amount:ev.target.value})}/>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {e.saved ? (
                          <span className="text-green-700 text-xs">Submitted</span>
                        ) : (
                          <button className="text-xs border rounded-lg px-2 py-1" onClick={()=>submitExpenseRow(e.id)}>Submit</button>
                        )}
                        <button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmExpense(e.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td className="font-semibold">Ksh {fmt(expenses.reduce((a,e)=>a+toNum(e.amount),0))}</td>
                  <td className="text-right">
                    <button className="btn-mobile px-3 py-2 rounded-xl border" onClick={submitExpenses}>Submit Expenses</button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ===== TILL PAYMENTS ===== */}
      {!assistantMode && tab === "till" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">Till Payments ({summaryMode === 'previous' ? 'Previous' : 'Active'} Period)</h3>
              {tillNumber && (
                <span className="inline-flex items-center rounded-xl border px-2 py-0.5 text-xs bg-white/5">
                  Till: <span className="ml-1 font-semibold">{tillNumber}</span>
                </span>
              )}
              <div className="inline-flex items-center gap-1 text-xs">
                <button
                  className={`px-2 py-1 rounded-lg border ${summaryMode==='current' ? 'bg-black text-white' : ''}`}
                  onClick={async()=>{ if(!outlet) return; setSummaryMode('current'); await refreshTill(outlet); }}
                >Current</button>
                <button
                  className={`px-2 py-1 rounded-lg border ${summaryMode==='previous' ? 'bg-black text-white' : ''}`}
                  onClick={async()=>{ if(!outlet) return; setSummaryMode('previous'); await refreshTill(outlet); }}
                >Previous</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {Math.abs(computed.varianceKsh) > 0.5 && (
                <button
                  className="btn-mobile text-xs border rounded-xl px-3 py-1"
                  onClick={async()=>{
                    if (!outlet) return;
                    const raw = promptSync("Recount till: enter counted cash amount (Ksh)", countedTill === "" ? "" : String(countedTill));
                    if (raw == null) return;
                    const n = Number(raw);
                    if (!isFinite(n) || n < 0) { notifyToast("Enter a non-negative number"); return; }
                    try {
                      setCountedTill(n);
                      await postJSON('/api/tillcount', { date: dateStr, outlet, counted: n });
                    } catch {}
                    try { await refreshPeriodAndHeader(outlet); } catch {}
                  }}
                >Recount Till</button>
              )}
              <button className="btn-mobile text-xs border rounded-xl px-3 py-1" onClick={()=>outlet && refreshTill(outlet)}>↻ Refresh</button>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
            Total Till Payments ({summaryMode === 'previous' ? dateStr : 'current period'}): <span className="font-semibold">Ksh {fmt(tillTotal)}</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Sort</label>
              <select
                className="border rounded px-2 py-1 text-xs"
                value={tillSort}
                onChange={async (e)=>{ const v = e.target.value as 'createdAt:asc'|'createdAt:desc'; setTillSort(v); if (outlet) await refreshTill(outlet); }}
              >
                <option value="createdAt:desc">Newest first</option>
                <option value="createdAt:asc">Oldest first</option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
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
          {summaryMode === 'current' && savedClosingTodayCount === 0 && depositsFromServer.length === 0 && !expenses.some(e=>e.saved) && toNum(countedTill) === 0 && (
            <div className="mb-3 inline-flex items-start gap-3 rounded-2xl border px-3 py-2 text-sm bg-yellow-50 border-yellow-200 text-yellow-700 w-full">
              <div>
                Current shows carryover from the just-closed period. Other totals appear after you make today’s first submission (closing, expense, deposit, or till count).
              </div>
            </div>
          )}
          {showRotationBanner && summaryMode === 'previous' && (
            <div className="mb-3 inline-flex items-start gap-3 rounded-2xl border px-3 py-2 text-sm bg-blue-50 border-blue-200 text-blue-800 w-full">
              <div>
                Summary is showing <span className="font-semibold">Previous day</span> results. Stock & Supply have moved to the new period.
              </div>
              <button
                className="ml-auto text-xs underline decoration-dotted"
                onClick={()=>{ try { if (outlet) window.localStorage.setItem(rotationBannerKeyFor(dateStr, outlet), 'dismissed'); } catch {} setShowRotationBanner(false); }}
              >Dismiss</button>
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">Summary</h3>
              <div className="inline-flex items-center gap-1 text-xs">
                <button
                  className={`px-2 py-1 rounded-lg border ${summaryMode==='current' ? 'bg-black text-white' : ''}`}
                  onClick={async()=>{ if(!outlet) return; setSummaryMode('current'); try { window.localStorage.setItem(summaryKeyFor(dateStr, outlet), 'current'); } catch {}; await refreshPeriodAndHeader(outlet, undefined); }}
                >Current</button>
                <button
                  className={`px-2 py-1 rounded-lg border ${summaryMode==='previous' ? 'bg-black text-white' : ''}`}
                  onClick={async()=>{ if(!outlet) return; setSummaryMode('previous'); try { window.localStorage.setItem(summaryKeyFor(dateStr, outlet), 'previous'); } catch {}; await refreshPeriodAndHeader(outlet, dateStr, true); }}
                >Previous</button>
                <span className="ml-2 text-[11px] text-gray-500">Showing: {summaryMode === 'previous' ? 'Previous' : 'Current'}</span>
              </div>
            </div>
            <button
              className="btn-mobile border rounded-xl px-3 py-1 text-xs"
              onClick={() => window.print()}
            >
              Download PDF
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <CardKPI label="Weight Sales (Ksh)" value={`Ksh ${fmt(kpi.weightSales)}`} tooltip={summaryMode==='previous' ? 'Closed day: sum of (opening − closing − waste) × price for that day.' : 'For Current, totals reflect only submitted items so far.'} />
            <CardKPI label="Expenses (Ksh)" value={`Ksh ${fmt(kpi.expenses)}`} tooltip={summaryMode==='previous' ? 'Closed day expenses.' : 'Submitted expenses so far for today.'} />
            <CardKPI
              label="Today Total Sales (Ksh)"
              value={`Ksh ${fmt(kpi.todayTotalSales)}`}
              tooltip={"Calculated from stock: sum over items of (opening − closing − waste) × price, then minus expenses."}
            />
            {!assistantMode && (
              <>
                <CardKPI label="Till Sales (Gross)" value={`Ksh ${fmt(kpi.tillSalesGross)}`} tooltip={summaryMode==='previous' ? 'Gross till payments for the closed day.' : 'Gross till payments so far in the current period.'} />
                <CardKPI label="Till Sales (Net)" value={`Ksh ${fmt(kpi.tillSalesNet)}`} tooltip={"Till takings after adjustments (e.g., reversals/invalids/fees). Gross shows raw takings."} />
              </>
            )}
            <CardKPI label="Verified Deposits" value={`Ksh ${fmt(kpi.verifiedDeposits)}`} tooltip={summaryMode==='previous' ? 'Deposits verified for the closed day.' : 'Deposits verified so far today.'} />
            <CardKPI
              label="Carryover (Prev)"
              value={`Ksh ${fmt(kpi.carryoverPrev || 0)}`}
              tooltip={summaryMode==='previous' ? 'Outstanding entering that closed day from earlier periods.' : "Pending from the previous period to be deposited today."}
            />
            {summaryMode === 'current' && (
              <CardKPI label="Till Variance (Ksh)" value={`Ksh ${fmt(computed.varianceKsh)}`} highlightDanger={Math.abs(computed.varianceKsh) > 0.5} />
            )}
            {summaryMode === 'current' && savedClosingTodayCount === 0 && depositsFromServer.length === 0 && !expenses.some(e=>e.saved) && toNum(countedTill) === 0 && (kpi.openingValue || 0) > 0 && (
              <CardKPI
                label="Opening Value (supply)"
                value={`Ksh ${fmt(kpi.openingValue || 0)}`}
                tooltip={'Estimated value of today\'s opening stock (yesterday\'s closing + today\'s supply) priced at current sell prices.'}
              />
            )}
          </div>

          {/* ✅ Highlight red ONLY when > 0 */}
          {assistantMode && assistantInsights && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-3 text-sm">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h4 className="font-semibold text-blue-900">Assistant Deposit Snapshot</h4>
                <span className="text-xs text-blue-700">Period state: {assistantInsights.periodState || "unknown"}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mb-2">
                <div>Sales from stock: <span className="font-medium">Ksh {fmt(assistantInsights.salesValue)}</span></div>
                <div>Expenses: <span className="font-medium">Ksh {fmt(assistantInsights.expensesValue)}</span></div>
                <div>Expected deposit: <span className="font-medium">Ksh {fmt(assistantInsights.expected)}</span></div>
                <div>Deposited so far: <span className="font-medium">Ksh {fmt(assistantInsights.depositedSoFar)}</span></div>
                <div className="sm:col-span-2">Recommended now: <span className="font-semibold text-blue-900">Ksh {fmt(assistantInsights.recommendedNow)}</span></div>
              </div>
              {assistantInsights.warnings && assistantInsights.warnings.length > 0 && (
                <ul className="mb-2 text-xs text-blue-700 list-disc list-inside">
                  {assistantInsights.warnings.map((w, idx) => (
                    <li key={`assistant-warning-${idx}`}>{w}</li>
                  ))}
                </ul>
              )}
              {assistantInsights.breakdown && assistantInsights.breakdown.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-blue-100 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-blue-900/5 text-blue-900">
                      <tr>
                        <th className="text-left px-3 py-2">Product</th>
                        <th className="text-right px-3 py-2">Sold</th>
                        <th className="text-right px-3 py-2">Price</th>
                        <th className="text-right px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assistantInsights.breakdown.map((row, idx) => (
                        <tr key={`${row.productKey}-${idx}`} className="border-t border-blue-100">
                          <td className="px-3 py-2 font-medium text-blue-900">{row.productName}</td>
                          <td className="px-3 py-2 text-right">{fmt(row.salesUnits)}</td>
                          <td className="px-3 py-2 text-right">Ksh {fmt(row.price)}</td>
                          <td className="px-3 py-2 text-right">Ksh {fmt(row.salesValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {assistantMode && assistantOpeningView.length > 0 && (
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
                  <h4 className="font-semibold text-gray-900">Opening Stock</h4>
                  <p className="text-xs text-gray-500">Read-only view sourced from supplier submissions.</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-4 py-2">Item</th>
                      <th className="text-right px-4 py-2">Qty</th>
                      <th className="text-left px-4 py-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assistantOpeningView.map((row) => (
                      <tr key={`assistant-open-${row.key}`} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-medium text-gray-900">{row.name}</td>
                        <td className="px-4 py-2 text-right">{fmt(row.qty)}</td>
                        <td className="px-4 py-2 text-gray-600">{row.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="mt-4">
            {(() => {
              const amt = Number(kpi.amountToDeposit || 0);
              const isExcess = amt < 0;
              const label = isExcess ? "Excess (Ksh)" : "Amount to Deposit (Ksh)";
              const value = `Ksh ${fmt(Math.abs(amt))}`;
              const tooltip = isExcess
                ? "Excess indicates a surplus (e.g., over-deposit or commissions). We show the absolute value."
                : "Carryover (Prev) + Today Total Sales − Verified Deposits − Till Sales (Gross)";
              const subtitle = isExcess
                ? (refreshingKpi ? 'Surplus (over-deposit, commissions, or payouts) • Refreshing…' : 'Surplus (over-deposit, commissions, or payouts).')
                : (refreshingKpi ? 'Refreshing…' : undefined);
              return (
                <CardKPI
                  label={label}
                  value={value}
                  subtitle={subtitle}
                  highlightDanger={amt > 0}
                  highlightSuccess={isExcess}
                  tooltip={tooltip}
                />
              );
            })()}
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
  highlightSuccess,
  tooltip,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;         // legacy yellow style (kept)
  highlightDanger?: boolean;   // red style when true
  highlightSuccess?: boolean;  // green style when true
  tooltip?: string;            // Optional explanatory tooltip
}) {
  const base = "rounded-2xl border p-4";
  const yellow = "bg-yellow-50 border-yellow-200";
  const red = "bg-red-50 border-red-300";
  const green = "bg-green-50 border-green-200";
  const wrapClass = `${base} ${highlightDanger ? red : highlightSuccess ? green : highlight ? yellow : ""}`;
  const textColor = highlightDanger ? "text-red-700" : highlightSuccess ? "text-green-700" : "text-gray-500";

  return (
    <div className={wrapClass}>
      <div className={`text-sm ${textColor}`}>
        <span>{label}</span>
        {tooltip && (
          <span
            className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full border text-[10px] align-middle"
            title={tooltip}
            aria-label={tooltip}
          >i</span>
        )}
      </div>
      <div className={`text-xl font-semibold mt-1 ${textColor}`}>{value}</div>
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

/** Lightweight Till picker that loads active tills and returns the tillNumber */
function TillPicker({ onChange }: { onChange: (code: string) => void }) {
  const [tills, setTills] = React.useState<Array<{ label: string; tillNumber: string; outletCode: string }>>([]);
  const [value, setValue] = React.useState<string>(typeof window !== 'undefined' ? (localStorage.getItem('till_view_code') || '') : '');
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tills/list', { cache: 'no-store' });
        const j = await res.json();
        const rows = Array.isArray(j.rows) ? j.rows : [];
        setTills(rows.map((r: any) => ({ label: r.label || r.tillNumber, tillNumber: r.tillNumber, outletCode: r.outletCode })));
      } catch {}
    })();
  }, []);
  return (
    <select
      className="border rounded-lg px-2 py-1"
      value={value}
      onChange={(e)=>{ setValue(e.target.value); onChange(e.target.value); }}
      title="Pick a till"
    >
      <option value="">— pick till —</option>
      {tills.map(t => (
        <option key={t.tillNumber} value={t.tillNumber}>{t.label} — {t.tillNumber}</option>
      ))}
    </select>
  );
}

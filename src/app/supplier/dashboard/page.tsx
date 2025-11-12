// src/app/supplier/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { hydrateLocalStorageFromDB } from "@/lib/settingsBridge";
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON } from "@/utils/safeStorage";
import { notifyToast, registerAdminToast } from '@/lib/toast';
import { promptSync, confirmSync } from '@/lib/ui';

/* =========================
   Types (aligned with Admin)
   ========================= */
type Unit = "kg" | "pcs";

type Product = {
  id: string;
  key: string;               // "beef", "goat", ...
  name: string;
  unit: Unit;
  sellPrice: number;         // Admin global default (kept for info)
  active: boolean;
};

const FRACTIONAL_PCS_KEYS = new Set<string>(["mutura", "samosas"]);

function allowsFractionalQty(unit: Unit, key?: string | null): boolean {
  if (unit === "kg") return true;
  if (unit === "pcs" && key) {
    const keyLc = key.toLowerCase();
    return FRACTIONAL_PCS_KEYS.has(keyLc);
  }
  return false;
}

type Outlet = {
  id: string;
  name: string;              // "Bright", "Baraka A", ...
  code?: string;             // legacy field (ignored here)
  active: boolean;
};

/** A single supply row (supplier UI only) */
type SupplyRow = {
  id: string;
  itemKey: string;    // product.key
  qty: number;        // weight or pieces
  buyPrice: number;   // per unit
  unit: Unit;         // "kg" or "pcs" (copied from product)
  locked?: boolean;
  lockedAt?: string | null;
  lockedBy?: string | null;
};

/** Minimal opening row (what Attendant reads) */
type OpeningItem = { itemKey: string; qty: number };

/** A transfer record (supplier → cross outlet) */
type TransferRow = {
  id: string;
  date: string;       // YYYY-MM-DD
  fromOutletName: string;
  toOutletName: string;
  itemKey: string;
  qty: number;
  unit: Unit;
};

/** Disputes (support both Attendant- and Supplier-created shapes) */
type AmendComment = { by: string; at: string; text: string };
type AnyAmend = {
  id: string;
  date: string;
  outlet?: string;             // attendants use 'outlet'
  outletName?: string;         // suppliers may use 'outletName'
  requestedBy?: string;
  type?: string;               // "supply" | "transfer" | "supplier_adjustment"
  itemKey?: string;
  qty?: number;
  description?: string;
  status?: "pending" | "approved" | "rejected";
  createdAt?: string;
  comments?: AmendComment[];
};

/* =========================
   Storage Keys
   ========================= */

/** Minimal Opening list for Attendant (Array<{itemKey, qty}>) */
const supplierOpeningKey = (date: string, outletName: string) =>
  `supplier_opening_${date}_${outletName}`;

/** Supplier private editable copy (SupplyRow[]) */
const supplierOpeningFullKey = (date: string, outletName: string) =>
  `supplier_opening_full_${date}_${outletName}`;

/** Optional cost map (per date/outlet): { [itemKey]: unitCost } */
const supplierCostKey = (date: string, outletName: string) =>
  `supplier_cost_${date}_${outletName}`;

/** Submission lock (after submit, only supervisor can edit) */
const supplierSubmittedKey = (date: string, outletName: string) =>
  `supplier_submitted_${date}_${outletName}`;

/** Cross-outlet transfers for a given date */
const supplierTransfersKey = (date: string) => `supplier_transfers_${date}`;

/** Global amend requests list */
const AMEND_REQUESTS_KEY = "amend_requests";

/** Admin data keys (from Admin page) */
const K_OUTLETS  = "admin_outlets";
const K_PRODUCTS = "admin_products";
const K_PRICEBOOK = "admin_pricebook";

// (Optional fallback if someone used v2 keys earlier)
const K_OUTLETS_V2  = "admin_outlets_v2";
const K_PRODUCTS_V2 = "admin_products_v2";

/* =========================
   Helpers
   ========================= */
function rid(): string {
  return Math.random().toString(36).slice(2);
}
function ymd(d = new Date()): string {
  return d.toISOString().split("T")[0];
}
function loadLS<T>(key: string, fallback: T): T { return safeReadJSON<T>(key, fallback); }
function saveLS<T>(key: string, value: T): void { try { safeWriteJSON(key, value); } catch {} }
async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function toNumStr(s: string): number {
  // Tolerant numeric parser:
  // - Accepts values like "4kgs" or "3,5 kg" by using parseFloat
  // - Treats comma as decimal separator
  // - Falls back to 0 for empty/NaN
  if (s == null) return 0;
  const raw = String(s).trim();
  if (raw === "") return 0;
  const normalized = raw.replace(/,/g, ".");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number) {
  return (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* =========================
   Page
   ========================= */
export default function SupplierDashboard(): JSX.Element {
  /* Admin data */
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pricebook, setPricebook] = useState<Record<string, Record<string, { sellPrice: number; active: boolean }>>>({});

  /* Selection */
  const [dateStr, setDateStr] = useState<string>(ymd());
  const [outletId, setOutletId] = useState<string>("");

  /* Supply table state */
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [qtyDraftById, setQtyDraftById] = useState<Record<string, string>>({});
  const [priceDraftById, setPriceDraftById] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<boolean>(false);

  useEffect(() => {
    const ids = new Set(rows.map((r) => r.id));
    setQtyDraftById((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (ids.has(key)) next[key] = value;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setPriceDraftById((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (ids.has(key)) next[key] = value;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  /* Transfers */
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

  /* Disputes list for viewing/comment */
  const [amends, setAmends] = useState<AnyAmend[]>([]);

  /* Prices view (per selected outlet) */
  const [prices, setPrices] = useState<Array<{ key: string; name: string; price: number; active: boolean }>>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const sellPriceByKey = useMemo(() => Object.fromEntries(prices.map(p => [p.key, Number(p.price) || 0])), [prices]);
  const [showPricebook, setShowPricebook] = useState<boolean>(false);
  const [tab, setTab] = useState<'supply' | 'pricebook' | 'transfers' | 'disputes'>('supply');
  // Refs for tab buttons to support keyboard navigation
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const tabOrder: ('supply' | 'pricebook' | 'transfers' | 'disputes')[] = ['supply', 'pricebook', 'transfers', 'disputes'];

  const focusTabAt = (idx: number) => {
    const el = tabRefs.current[idx];
    if (el) el.focus();
  };

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key;
    const activeIndex = tabRefs.current.findIndex((el) => el === document.activeElement);
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      e.preventDefault();
      const next = (activeIndex + 1 + tabOrder.length) % tabOrder.length;
      focusTabAt(next);
      setTab(tabOrder[next]);
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      e.preventDefault();
      const prev = (activeIndex - 1 + tabOrder.length) % tabOrder.length;
      focusTabAt(prev);
      setTab(tabOrder[prev]);
    } else if (key === 'Home') {
      e.preventDefault();
      focusTabAt(0);
      setTab(tabOrder[0]);
    } else if (key === 'End') {
      e.preventDefault();
      focusTabAt(tabOrder.length - 1);
      setTab(tabOrder[tabOrder.length - 1]);
    } else if (key === 'Enter' || key === ' ') {
      // Activate (already handled by setTab on focus changes)
    }
  };

  /* Welcome name */
  const [welcomeName, setWelcomeName] = useState<string>("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  useEffect(() => { if (!toastMsg) return; const id = setTimeout(()=>setToastMsg(null), 3500); return ()=>clearTimeout(id); }, [toastMsg]);
  useEffect(() => { try { registerAdminToast((m) => setToastMsg(m)); } catch {} ; return () => { try { registerAdminToast(null); } catch {} } }, []);
  // Local alias for compatibility
  const _localNotify = (msg: string|null) => { try { setToastMsg(msg); } catch {} };

  /* Quick maps */
  const productByKey = useMemo(() => {
    const map: Record<string, Product> = {};
    for (const p of products) map[p.key] = p;
    return map;
  }, [products]);

  const outletById = useMemo(() => {
    const map: Record<string, Outlet> = {};
    for (const o of outlets) map[o.id] = o;
    return map;
  }, [outlets]);

  // TRIM the outlet name so storage keys match Attendant side exactly
  const selectedOutletName = useMemo<string>(
    () => (outletById[outletId]?.name ?? "").trim(),
    [outletById, outletId]
  );

  const refreshSupplyState = useCallback(
    async (opts?: { skipTransfers?: boolean }) => {
      if (!selectedOutletName) return;

      const fullKey = supplierOpeningFullKey(dateStr, selectedOutletName);
      const minimalKey = supplierOpeningKey(dateStr, selectedOutletName);
      const costKey = supplierCostKey(dateStr, selectedOutletName);

      let rowsFromServer: Array<{
        itemKey: string;
        qty: number;
        unit?: Unit;
        buyPrice?: number;
        locked?: boolean;
        lockedAt?: string | null;
        lockedBy?: string | null;
      }> | null = null;
      try {
        const query = new URLSearchParams({ date: dateStr, outlet: selectedOutletName }).toString();
        const r = await fetch(`/api/supply/opening?${query}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          rowsFromServer = (j?.rows || []).map((x: any) => ({
            itemKey: String(x?.itemKey || ""),
            qty: Number(x?.qty || 0),
            unit: x?.unit === "pcs" ? "pcs" : "kg",
            buyPrice: Number(x?.buyPrice || 0),
            locked: Boolean(x?.locked),
            lockedAt: typeof x?.lockedAt === "string" ? x.lockedAt : null,
            lockedBy: x?.lockedBy ? String(x.lockedBy) : null,
          }));
        }
      } catch {
        // Ignore network errors; we'll fall back to cached local storage.
      }

      const existingFull = loadLS<SupplyRow[]>(fullKey, []);
      let nextRows: SupplyRow[] = existingFull;

      if (rowsFromServer !== null) {
        const costMap = loadLS<Record<string, number>>(costKey, {});
        const previousByItem = new Map<string, SupplyRow>();
        for (const row of existingFull) previousByItem.set(row.itemKey, row);

        const merged: SupplyRow[] = [];
        const seen = new Set<string>();

        for (const serverRow of rowsFromServer) {
          const prev = previousByItem.get(serverRow.itemKey);
          const product = productByKey[serverRow.itemKey];
          const locked = Boolean(serverRow.locked);
          const qty = locked ? serverRow.qty : (prev?.qty ?? serverRow.qty);
          const buyPriceCandidate = locked
            ? serverRow.buyPrice ?? prev?.buyPrice ?? costMap[serverRow.itemKey] ?? 0
            : prev?.buyPrice ?? serverRow.buyPrice ?? costMap[serverRow.itemKey] ?? 0;

          merged.push({
            id: prev?.id ?? rid(),
            itemKey: serverRow.itemKey,
            qty,
            buyPrice: Number.isFinite(buyPriceCandidate) ? buyPriceCandidate : 0,
            unit: prev?.unit ?? serverRow.unit ?? product?.unit ?? "kg",
            locked,
            lockedAt: serverRow.lockedAt ?? prev?.lockedAt ?? null,
            lockedBy: serverRow.lockedBy ?? prev?.lockedBy ?? null,
          });
          seen.add(serverRow.itemKey);
        }

        // Preserve any local draft rows that haven't been synced yet
        for (const row of existingFull) {
          if (seen.has(row.itemKey)) continue;
          merged.push(row);
        }

        nextRows = merged;
        saveLS(fullKey, nextRows);
        saveLS(minimalKey, nextRows.map((r) => ({ itemKey: r.itemKey, qty: r.qty })));
      }

      if (nextRows.length === 0) {
        const minimal = loadLS<OpeningItem[]>(minimalKey, []);
        nextRows = minimal.map((mi) => {
          const product = productByKey[mi.itemKey];
          return {
            id: rid(),
            itemKey: mi.itemKey,
            qty: mi.qty,
            buyPrice: 0,
            unit: product?.unit ?? "kg",
            locked: false,
            lockedAt: null,
            lockedBy: null,
          };
        });
      }

      setRows(nextRows);

      const isSubmitted = loadLS<boolean>(supplierSubmittedKey(dateStr, selectedOutletName), false);
      setSubmitted(isSubmitted);

      if (!opts?.skipTransfers) {
        try {
          const r = await fetch(`/api/supply/transfer?date=${encodeURIComponent(dateStr)}`, { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            const list: TransferRow[] = (j?.rows || []).map((t: any) => ({
              id: String(t?.id || rid()),
              date: String(t?.date || dateStr),
              fromOutletName: String(t?.fromOutletName || ""),
              toOutletName: String(t?.toOutletName || ""),
              itemKey: String(t?.itemKey || ""),
              qty: Number(t?.qty || 0),
              unit: (t?.unit === "pcs" ? "pcs" : "kg") as Unit,
            }));
            saveLS(supplierTransfersKey(dateStr), list);
            setTransfers(list);
          } else {
            const fallback = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
            setTransfers(fallback);
          }
        } catch {
          const fallback = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
          setTransfers(fallback);
        }
      }

      const amendList = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
      setAmends(
        amendList.filter(
          (a) =>
            (a.outlet && a.outlet === selectedOutletName) ||
            (a.outletName && a.outletName === selectedOutletName)
        )
      );
    },
    [dateStr, selectedOutletName, productByKey]
  );

  useEffect(() => {
    if (!selectedOutletName) {
      setRows([]);
      setTransfers([]);
      setAmends([]);
      setSubmitted(false);
      return;
    }
    refreshSupplyState();
  }, [dateStr, selectedOutletName, refreshSupplyState]);

  /* Pricebook filter helpers */
  const isProductActiveForOutlet = (p: Product, outletName: string): boolean => {
    const row = pricebook[outletName]?.[p.key];
    if (row) return !!row.active;
    return !!p.active; // fallback to global
  };

  /* Load admin data + session (once) */
  useEffect(() => {
    // Hydrate from DB first (thin persistence); non-blocking for UI
    (async () => { try { await hydrateLocalStorageFromDB(); } catch {} })();

    // Outlets (prefer v1 key, fallback to v2)
    const o1 = loadLS<Outlet[]>(K_OUTLETS, []);
    const o2 = o1.length ? o1 : loadLS<Outlet[]>(K_OUTLETS_V2, []);
    setOutlets(o2);

    // Products (prefer v1 key, fallback to v2)
    const p1raw = loadLS<any[]>(K_PRODUCTS, []);
    const p2raw = p1raw.length ? p1raw : loadLS<any[]>(K_PRODUCTS_V2, []);
    // Normalize product fields (sellPrice vs defaultSellPrice)
    const normProducts: Product[] = (p2raw || []).map((p: any) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      unit: (p.unit as Unit) ?? "kg",
      sellPrice: typeof p.sellPrice === "number" ? p.sellPrice : (p.defaultSellPrice ?? 0),
      active: !!p.active,
    }));
    setProducts(normProducts);

    // Pricebook
    const pb = loadLS<typeof pricebook>(K_PRICEBOOK, {});
    setPricebook(pb || {});

    // Welcome
    setWelcomeName(sessionStorage.getItem("supplier_name") || "");

    // Pin date to today within active period of first outlet (best effort)
    (async () => {
      try {
        const first = o2.find(o => o.active);
        const outletName = (first?.name || "").trim();
        if (!outletName) return;
        const r = await fetch(`/api/period/active?outlet=${encodeURIComponent(outletName)}`, { cache: "no-store" });
        const j = await r.json().catch(()=>({ ok: true, active: null }));
        // We keep date as today; active period is validated server-side in API routes.
        setDateStr(ymd());
      } catch {}
    })();
  }, []);

  /* Initialize outlet selection to first active */
  useEffect(() => {
    if (outlets.length > 0 && !outletId) {
      const firstActive = outlets.find(o => o.active) || outlets[0];
      setOutletId(firstActive.id);
    }
  }, [outlets, outletId]);

  // Load outlet pricebook for info (supplier can compare against buy price)
  async function refreshPrices() {
    if (!selectedOutletName) return;
    try {
      setPricesLoading(true);
      setPricesError(null);
      const r = await fetch(`/api/pricebook/outlet?outlet=${encodeURIComponent(selectedOutletName)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setPrices(Array.isArray(j?.products) ? j.products : []);
    } catch (e: any) {
      setPrices([]);
      setPricesError(typeof e?.message === "string" ? e.message : "Failed to load prices");
    } finally {
      setPricesLoading(false);
    }
  }
  useEffect(() => {
    if (!selectedOutletName) return;
    refreshPrices();
    const id = setInterval(() => refreshPrices(), 5000);
    return () => clearInterval(id);
  }, [selectedOutletName]);

  /* ===== Row operations ===== */
  const addRow = (itemKey: string): void => {
    if (!itemKey) return;
    const p = productByKey[itemKey];
    if (!p) return;
    setRows((prev) => [
      ...prev,
      {
        id: rid(),
        itemKey,
        qty: 0,
        buyPrice: 0,
        unit: p.unit,
        locked: false,
        lockedAt: null,
        lockedBy: null,
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<SupplyRow>): void => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.locked) return r;
        return { ...r, ...patch };
      }),
    );
  };

  const removeRow = (id: string): void => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.locked) {
        notifyToast("Item already locked; contact supervisor for changes.");
        return prev;
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  /* ===== Save (draft) ===== */
  const saveDraft = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!selectedOutletName) return false;
    // Save full rows for supplier UI
    saveLS(supplierOpeningFullKey(dateStr, selectedOutletName), rows);
    // Also save minimal (aggregated) for attendants
    const minimal = toMinimal(rows);
    saveLS(supplierOpeningKey(dateStr, selectedOutletName), minimal);
    // Save cost map
    const costMap = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.itemKey] = r.buyPrice || 0;
      return acc;
    }, {});
    saveLS(supplierCostKey(dateStr, selectedOutletName), costMap);
    // Persist to server (best effort so attendants see updates on dashboard)
    let synced = false;
    try {
      const draftRows = rows.filter((r) => !r.locked);
      if (draftRows.length > 0) {
        await postJSON("/api/supply/opening", {
          date: dateStr,
          outlet: selectedOutletName,
          rows: draftRows.map((r) => ({
            itemKey: r.itemKey,
            qty: r.qty,
            buyPrice: r.buyPrice,
            unit: r.unit,
          })),
        });
      }
      synced = true;
    } catch (err) {
      console.error("Failed to sync supply opening rows", err);
    }

    // NEW: Auto-lock any newly entered rows that have a positive qty & buyPrice.
    // This enforces the requirement that once supplier enters stock it is saved & locked per item.
    // We only attempt locking for rows not yet locked and with sensible values (>0 for both qty & buyPrice).
    const lockable = rows.filter(r => !r.locked && r.qty > 0 && r.buyPrice > 0);
    if (lockable.length) {
      let lockedCount = 0;
      for (const r of lockable) {
        try {
          const supplierCode = sessionStorage.getItem("supplier_code");
          const supplierName = sessionStorage.getItem("supplier_name");
          const res = await fetch("/api/supply/opening/item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              date: dateStr,
              outlet: selectedOutletName,
              itemKey: r.itemKey,
              qty: r.qty,
              buyPrice: r.buyPrice,
              unit: r.unit,
              mode: "add",
              supplierCode,
              supplierName,
            }),
          });
          if (res.ok) lockedCount += 1; // individual lock success
        } catch (e) {
          // Non-fatal; continue locking other rows
          console.warn("Auto-lock failed for", r.itemKey, e);
        }
      }
      if (lockedCount > 0) {
        // Refresh state so UI reflects newly locked items
        await refreshSupplyState({ skipTransfers: true });
        if (!opts?.silent) notifyToast(`Auto-locked ${lockedCount} item${lockedCount === 1 ? "" : "s"}.`);
      }
    }
    await refreshSupplyState({ skipTransfers: true });
    if (!opts?.silent) {
      notifyToast(synced ? "Saved." : "Saved locally. Will sync when back online.");
    }
    return synced;
  };

  /* ===== Submit (lock) ===== */
  const submitDay = async (): Promise<void> => {
    if (!selectedOutletName) return;
    const unlocked = rows.filter((r) => !r.locked && r.qty > 0);
    if (unlocked.length === 0) {
      notifyToast("Nothing to submit; all rows already locked.");
      return;
    }

    await saveDraft({ silent: true });

    let success = 0;
    for (const row of unlocked) {
      const ok = await submitRow(row, { silent: true, mode: "add" });
      if (ok) success += 1;
    }

    await refreshSupplyState({ skipTransfers: true });
    if (success > 0) {
      notifyToast(`Submitted & locked ${success} item${success === 1 ? "" : "s"}. Day remains open for new supplies.`);
    } else {
      notifyToast("No new rows were submitted.");
    }
  };

  /* ===== Request modification to Supervisor ===== */
  const requestModification = (): void => {
    if (!selectedOutletName) return;

  const note = promptSync("Describe what needs to be corrected:", "") || "";
    if (!note) return;

    const req: AnyAmend = {
      id: rid(),
      date: dateStr,
      outletName: selectedOutletName,
      requestedBy: sessionStorage.getItem("supplier_code") || "supplier",
      type: "supplier_adjustment",
      description: note,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const list = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
    const next = [req, ...list];
    saveLS(AMEND_REQUESTS_KEY, next);
    setAmends(next.filter(a => (a.type === "supply" || a.type === "supplier_adjustment") &&
      ((a.outlet && a.outlet === selectedOutletName) || (a.outletName && a.outletName === selectedOutletName))));
  notifyToast("Modification request sent to Supervisor.");
  };

  // Per-row submit (one item at a time) with duplicate prompt
  const submitRow = async (
    r: SupplyRow,
    opts?: { silent?: boolean; mode?: "add" | "replace" }
  ): Promise<boolean> => {
    if (!selectedOutletName) return false;
    if (r.locked) {
      if (!opts?.silent) notifyToast("Already submitted.");
      return false;
    }
    const exists = rows.some((x) => x.itemKey === r.itemKey && x.id !== r.id);
    let mode: "add" | "replace" = opts?.mode ?? "add";
    if (!opts?.mode && exists) {
      const confirm = confirmSync(
        `You've already submitted ${r.itemKey} today. Do you want to add to existing quantity? Click Cancel to replace instead.`
      );
      mode = confirm ? "add" : "replace";
    }
    try {
      const supplierCode = sessionStorage.getItem("supplier_code");
      const supplierName = sessionStorage.getItem("supplier_name");
      const res = await fetch("/api/supply/opening/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          date: dateStr,
          outlet: selectedOutletName,
          itemKey: r.itemKey,
          qty: r.qty,
          buyPrice: r.buyPrice,
          unit: r.unit,
          mode,
          supplierCode,
          supplierName,
        }),
      });
      const j = await res.json().catch(()=>({ ok: false }));
      if (!j?.ok) throw new Error(j?.error || "Failed");
      // Mirror minimal + full locally
      const full = loadLS<SupplyRow[]>(supplierOpeningFullKey(dateStr, selectedOutletName), []);
      const idx = full.findIndex((x) => x.itemKey === r.itemKey);
      let nextFull = full.slice();
      const lockedSnapshot: SupplyRow = {
        ...r,
        qty: j.totalQty,
        locked: true,
        lockedAt: j?.row?.lockedAt ?? new Date().toISOString(),
        lockedBy: j?.row?.lockedBy ?? (supplierCode || "supplier_portal"),
      };
      if (idx === -1) nextFull.push(lockedSnapshot);
      else nextFull[idx] = lockedSnapshot;
      saveLS(supplierOpeningFullKey(dateStr, selectedOutletName), nextFull);
      const minimal = toMinimal(nextFull);
      saveLS(supplierOpeningKey(dateStr, selectedOutletName), minimal);
      setRows(nextFull);
      if (!opts?.silent) notifyToast(`Submitted ${r.itemKey} - locked at ${j.totalQty}`);
      return true;
    } catch (e: any) {
      if (!opts?.silent) {
        if (String(e?.message || "").toLowerCase().includes("locked")) notifyToast("Already locked for today.");
        else notifyToast(e?.message || "Submit failed");
      }
      return false;
    }
  };

  // Per-row: request modification (new weight + reason)
  const requestRowModification = async (r: SupplyRow) => {
  const newQtyStr = promptSync(`Enter new weight/qty for ${r.itemKey}:`, String(r.qty)) || "";
    if (!newQtyStr) return;
    const newQty = Number(newQtyStr);
  if (!(newQty > 0)) { notifyToast("Invalid number"); return; }
  const reason = promptSync("Reason for adjustment:", "") || "";
    if (!reason) return;
    try {
      const res = await fetch("/api/supply/adjustment/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ date: dateStr, outlet: selectedOutletName, itemKey: r.itemKey, currentQty: r.qty, newQty, reason, requestedBy: sessionStorage.getItem("supplier_code") || "supplier" }),
      });
      const j = await res.json().catch(()=>({ ok: false }));
      if (!j?.ok) throw new Error(j?.error || "Failed");
  notifyToast("Adjustment requested; pending supervisor approval.");
    } catch (e: any) {
  notifyToast(e?.message || "Request failed");
    }
  };

  /* ===== Add supplier comment on outlet-raised disputes ===== */
  const addAmendComment = (amendId: string) => {
  const text = promptSync("Add a short comment/reason (visible to Supervisor):", "") || "";
    if (!text) return;
    const code = sessionStorage.getItem("supplier_code") || "supplier";
    const list = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
    const next = list.map(a => {
      if (a.id !== amendId) return a;
      const comments = Array.isArray(a.comments) ? a.comments.slice() : [];
      comments.push({ by: code, at: new Date().toISOString(), text });
      return { ...a, comments };
    });
    saveLS(AMEND_REQUESTS_KEY, next);
    setAmends(next.filter(a => (a.type === "supply" || a.type === "supplier_adjustment") &&
      ((a.outlet && a.outlet === selectedOutletName) || (a.outletName && a.outletName === selectedOutletName))));
  };

  /* ===== Transfers ===== */
  const [txFromId, setTxFromId] = useState<string>("");
  const [txToId, setTxToId] = useState<string>("");
  const [txProductKey, setTxProductKey] = useState<string>("");
  const [txQty, setTxQty] = useState<string>("");

  useEffect(() => {
    // default from/to
    if (!txFromId && outlets.length) setTxFromId(outlets[0].id);
    if (!txToId && outlets.length > 1) setTxToId(outlets[1].id);
  }, [outlets, txFromId, txToId]);

  const addTransfer = async (): Promise<void> => {
    const fromName = (outletById[txFromId]?.name ?? "").trim();
    const toName = (outletById[txToId]?.name ?? "").trim();
    if (!fromName || !toName) {
  notifyToast("Please select valid outlets.");
      return;
    }
    if (fromName === toName) {
  notifyToast("From and To outlets must be different.");
      return;
    }
    const p = productByKey[txProductKey];
    if (!p) {
  notifyToast("Please select a product to transfer.");
      return;
    }
    const qtyNum = toNumStr(txQty);
    if (qtyNum <= 0) {
  notifyToast("Quantity must be greater than 0.");
      return;
    }

    // 1) Save the transfer record
    const rec: TransferRow = {
      id: rid(),
      date: dateStr,
      fromOutletName: fromName,
      toOutletName: toName,
      itemKey: txProductKey,
      qty: qtyNum,
      unit: p.unit,
    };
    const txList = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
    const nextTx = [rec, ...txList];
    saveLS(supplierTransfersKey(dateStr), nextTx);
    setTransfers(nextTx);

    // 2) Adjust FROM outlet (full + minimal)
    adjOutletOpening(fromName, txProductKey, -qtyNum, p.unit);
    // 3) Adjust TO outlet (full + minimal)
    adjOutletOpening(toName, txProductKey, +qtyNum, p.unit);

    // 4) Persist transfer to server (non-blocking)
    try { await postJSON("/api/supply/transfer", { date: dateStr, fromOutletName: fromName, toOutletName: toName, itemKey: txProductKey, qty: qtyNum, unit: p.unit }); } catch {}

    // Show a toast and keep the input value (we normalize via onBlur handler too)
    notifyToast("Transfer saved and applied to both outlets’ opening.");
    // Normalize input immediately so user sees canonical value
    const finalQtyStr = normalizeQtyForInput(qtyNum, p.unit, p.key);
    setTxQty(finalQtyStr);
  };

  // Normalize formatting helper (pcs -> integer, kg -> up to 2dp trimmed)
  const normalizeQtyForInput = (val: number, unit: Unit, key?: string | null) => {
    if (!Number.isFinite(val)) return "";
    if (!allowsFractionalQty(unit, key)) return String(Math.round(val));
    const s = val.toFixed(2);
    return s.replace(/\.00$/, "").replace(/(\.\d[1-9]?)0$/, "$1");
  };

  function adjOutletOpening(outletName: string, itemKey: string, delta: number, unit: Unit) {
    // FULL
    const full = loadLS<SupplyRow[]>(supplierOpeningFullKey(dateStr, outletName), []);
    const fullNext = adjustSupplyFull(full, itemKey, delta, unit);
    saveLS(supplierOpeningFullKey(dateStr, outletName), fullNext);

    // MINIMAL
    const minimal = loadLS<OpeningItem[]>(supplierOpeningKey(dateStr, outletName), []);
    const minimalNext = adjustSupplyMinimal(minimal, itemKey, delta);
    saveLS(supplierOpeningKey(dateStr, outletName), minimalNext);
  }

  function adjustSupplyFull(list: SupplyRow[], itemKey: string, delta: number, unit: Unit): SupplyRow[] {
    const idx = list.findIndex((r) => r.itemKey === itemKey);
    if (idx === -1) {
      return [...list, { id: rid(), itemKey, qty: Math.max(0, delta), buyPrice: 0, unit }];
    } else {
      const next = [...list];
      const now = next[idx];
      const newQty = Math.max(0, now.qty + delta);
      next[idx] = { ...now, qty: newQty };
      return next;
    }
  }
  function adjustSupplyMinimal(list: OpeningItem[], itemKey: string, delta: number): OpeningItem[] {
    const idx = list.findIndex((r) => r.itemKey === itemKey);
    if (idx === -1) {
      return [...list, { itemKey, qty: Math.max(0, delta) }];
    } else {
      const next = [...list];
      const now = next[idx];
      const newQty = Math.max(0, now.qty + delta);
      next[idx] = { ...now, qty: newQty };
      return next;
    }
  }

  function toMinimal(list: SupplyRow[]): OpeningItem[] {
    const map = new Map<string, number>();
    for (const r of list) {
      map.set(r.itemKey, (map.get(r.itemKey) || 0) + (r.qty || 0));
    }
    return Array.from(map.entries()).map(([itemKey, qty]) => ({ itemKey, qty }));
  }

  /* ===== Calculations ===== */
  const totals = useMemo(() => {
    let totalQty = 0;
    let totalBuy = 0;
    for (const r of rows) {
      totalQty += r.qty;
      totalBuy += r.qty * r.buyPrice;
    }
    return { totalQty, totalBuy };
  }, [rows]);

  /* ===== Print summary ===== */
  const printSummary = (): void => {
    window.print();
  };

  /* ===== Download PDF report (detail + general summary) ===== */
  const downloadPdfReport = (): void => {
    // Detail for selected outlet/date (use current rows)
    const detailRows = rows.map(r => {
      const name = productByKey[r.itemKey]?.name ?? r.itemKey.toUpperCase();
      const line = r.qty * r.buyPrice;
      return { name, qty: r.qty, unit: r.unit, buyPrice: r.buyPrice, line };
    });
    const detailTotal = detailRows.reduce((a, r) => a + r.line, 0);

    // General summary across outlets for date
    const general = outlets.map(o => {
      const outletName = (o.name || "").trim();
      const list = loadLS<SupplyRow[]>(supplierOpeningFullKey(dateStr, outletName), []);
      let kgQty = 0;
      let pcsQty = 0;
      let totalBuy = 0;
      for (const r of list) {
        if (r.unit === "kg") kgQty += r.qty || 0;
        else pcsQty += r.qty || 0;
        totalBuy += (r.qty || 0) * (r.buyPrice || 0);
      }
      return { outlet: outletName, kgQty, pcsQty, totalBuy };
    });

    const genTotals = general.reduce(
      (a, g) => ({ kgQty: a.kgQty + g.kgQty, pcsQty: a.pcsQty + g.pcsQty, totalBuy: a.totalBuy + g.totalBuy }),
      { kgQty: 0, pcsQty: 0, totalBuy: 0 }
    );

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Supply Report - ${dateStr}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 8px; border: 1px solid #ddd; text-align: left; }
  tfoot td { font-weight: 600; }
  .muted { color: #555; }
</style>
</head>
<body>
  <h1>Supply Report</h1>
  <div class="muted">Date: ${dateStr}</div>
  <div class="muted">Outlet (detail): ${selectedOutletName || "—"}</div>

  <h2>Outlet Supply Detail</h2>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Buy Price</th><th>Line Total</th></tr></thead>
    <tbody>
      ${detailRows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${(r.qty || 0).toLocaleString()}</td>
          <td>${r.unit}</td>
          <td>${(r.buyPrice || 0).toLocaleString()}</td>
          <td>${(r.line || 0).toLocaleString()}</td>
        </tr>
      `).join("")}
    </tbody>
    <tfoot>
      <tr><td colspan="4">Total Buying Cost</td><td>${detailTotal.toLocaleString()}</td></tr>
    </tfoot>
  </table>

  <h2>General Supply Summary (All Outlets)</h2>
  <table>
    <thead><tr><th>Outlet</th><th>KG Qty</th><th>PCS Qty</th><th>Total Buying Cost</th></tr></thead>
    <tbody>
      ${general.map(g => `
        <tr>
          <td>${g.outlet}</td>
          <td>${g.kgQty.toLocaleString()}</td>
          <td>${g.pcsQty.toLocaleString()}</td>
          <td>${g.totalBuy.toLocaleString()}</td>
        </tr>
      `).join("")}
    </tbody>
    <tfoot>
      <tr>
        <td>Totals</td>
        <td>${genTotals.kgQty.toLocaleString()}</td>
        <td>${genTotals.pcsQty.toLocaleString()}</td>
        <td>${genTotals.totalBuy.toLocaleString()}</td>
      </tr>
    </tfoot>
  </table>

  <script>
    window.onload = () => { window.print(); };
  </script>
</body>
</html>
    `.trim();

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  /* =========================
     Render
     ========================= */
  const logout = () => {
    try {
      sessionStorage.removeItem("supplier_name");
      sessionStorage.removeItem("supplier_code");
    } catch {}
    window.location.href = "/supplier";
  };

  return (
    <main className="mobile-container p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Supplier Dashboard</h1>
            <p className="text-sm text-gray-600">
              {welcomeName ? <>Welcome <span className="font-medium">{welcomeName}</span>. </> : null}
              Enter opening supply, manage transfers, and respond to disputes.
            </p>
          </div>
        </div>

  {/* Menu bar (sticky) */}
  <div className="mt-3 sticky top-0 z-20 rounded-2xl border p-3 flex items-center gap-3 flex-wrap mobile-scroll-x bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Outlet</label>
            <select
              className="input-mobile border rounded-xl p-2 text-sm"
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Date</label>
            <input
              className="input-mobile border rounded-xl p-2 text-sm"
              type="date"
              value={dateStr}
              readOnly
              disabled
            />
          </div>

          <div className="flex items-center gap-2" role="tablist" aria-label="Supplier menu" onKeyDown={handleTabKeyDown}>
            <button
              id="tab-supply"
              ref={(el) => { tabRefs.current[0] = el; }}
              role="tab"
              aria-selected={tab === 'supply'}
              aria-controls="panel-supply"
              tabIndex={tab === 'supply' ? 0 : -1}
              className={`btn-mobile border rounded-2xl px-3 py-2 text-sm ${tab === 'supply' ? 'bg-white/10 text-white ring-1 ring-white/20' : 'text-gray-300'}`}
              onClick={() => setTab('supply')}
            >
              Record Supply
            </button>
            <button
              id="tab-pricebook"
              ref={(el) => { tabRefs.current[1] = el; }}
              role="tab"
              aria-selected={tab === 'pricebook'}
              aria-controls="panel-pricebook"
              tabIndex={tab === 'pricebook' ? 0 : -1}
              className={`btn-mobile border rounded-2xl px-3 py-2 text-sm ${tab === 'pricebook' ? 'bg-white/10 text-white ring-1 ring-white/20' : 'text-gray-300'}`}
              onClick={() => setTab('pricebook')}
            >
              Pricebook
            </button>
            <button
              id="tab-transfers"
              ref={(el) => { tabRefs.current[2] = el; }}
              role="tab"
              aria-selected={tab === 'transfers'}
              aria-controls="panel-transfers"
              tabIndex={tab === 'transfers' ? 0 : -1}
              className={`btn-mobile border rounded-2xl px-3 py-2 text-sm ${tab === 'transfers' ? 'bg-white/10 text-white ring-1 ring-white/20' : 'text-gray-300'}`}
              onClick={() => setTab('transfers')}
            >
              Transfers
            </button>
            <button
              id="tab-disputes"
              ref={(el) => { tabRefs.current[3] = el; }}
              role="tab"
              aria-selected={tab === 'disputes'}
              aria-controls="panel-disputes"
              tabIndex={tab === 'disputes' ? 0 : -1}
              className={`btn-mobile border rounded-2xl px-3 py-2 text-sm ${tab === 'disputes' ? 'bg-white/10 text-white ring-1 ring-white/20' : 'text-gray-300'}`}
              onClick={() => setTab('disputes')}
            >
              Disputes
            </button>
            <Link href="/supplier/history" className="btn-mobile border rounded-2xl px-3 py-2 text-sm text-gray-300">
              History
            </Link>
          </div>

          <div className="flex-1" />

          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      

      {/* Conditional content area: show only the selected tab's content */}
      {tab === 'supply' && (
        <section className="rounded-2xl border p-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Opening Supply — {selectedOutletName || "—"} ({dateStr})</h2>
          <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-1 text-xs" onClick={() => void saveDraft()} disabled={!selectedOutletName}>
                Save
              </button>
              {/* NEW: Download PDF */}
              <button className="border rounded-xl px-3 py-1 text-xs" onClick={downloadPdfReport} disabled={!selectedOutletName}>
                Download PDF
              </button>
              <button
                className="border rounded-xl px-3 py-1 text-xs bg-black text-white"
                onClick={submitDay}
                disabled={!selectedOutletName}
                title="Submit (keeps day open)"
              >
                Submit
              </button>
            </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3 mobile-scroll-x">
          <label className="text-sm text-gray-600">Add Item:</label>
          <select
            className="input-mobile border rounded-xl p-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              addRow(e.target.value);
              e.currentTarget.value = "";
            }}
            disabled={submitted}
          >
            <option value="" disabled>
              Select product…
            </option>
            {products
              .filter((p) => p.active && (!selectedOutletName || isProductActiveForOutlet(p, selectedOutletName)))
              .map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>

        <div className="table-wrap mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Buy Price / Unit</th>
                <th>Total (Ksh)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={6}>
                    No items yet. Use “Add Item”.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const p = productByKey[r.itemKey];
                const name = p?.name ?? r.itemKey.toUpperCase();
                const unit = p?.unit ?? r.unit;
                const line = r.qty * r.buyPrice;
                const sell = sellPriceByKey[r.itemKey] || 0;
                const marginPerUnit = sell - (r.buyPrice || 0);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="py-2">
                      {name}
                      {r.locked ? (
                        <span className="ml-2 inline-block rounded bg-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                          Locked
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="input-mobile border rounded-xl p-2 w-28"
                        type="text"
                        inputMode={unit === "kg" ? "decimal" : "numeric"}
                        placeholder={unit === "kg" ? "e.g. 4.5 kg" : "e.g. 4 pcs"}
                        value={qtyDraftById[r.id] ?? normalizeQtyForInput(r.qty ?? 0, unit, r.itemKey)}
                        disabled={submitted || r.locked}
                        onChange={(e) => {
                          if (submitted || r.locked) return;
                          const raw = e.target.value;
                          if (raw === "") {
                            setQtyDraftById((prev) => ({ ...prev, [r.id]: raw }));
                            updateRow(r.id, { qty: 0 });
                            return;
                          }
                          const allowFractional = allowsFractionalQty(unit, r.itemKey);
                          const allowed = allowFractional ? /^\d*(?:[.,]\d*)?$/ : /^\d*$/;
                          if (!allowed.test(raw)) return;
                          setQtyDraftById((prev) => ({ ...prev, [r.id]: raw }));
                          const n = toNumStr(raw);
                          const clamped = n < 0 ? 0 : n;
                          const finalQty = allowFractional ? clamped : Math.round(clamped);
                          updateRow(r.id, { qty: finalQty });
                        }}
                        onBlur={(e) => {
                          if (submitted || r.locked) return;
                          const n = toNumStr(e.target.value);
                          const clamped = n < 0 ? 0 : n;
                          const allowFractional = allowsFractionalQty(unit, r.itemKey);
                          const finalQty = allowFractional ? clamped : Math.round(clamped);
                          updateRow(r.id, { qty: finalQty });
                          setQtyDraftById((prev) => {
                            if (!(r.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[r.id];
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>{unit}</td>
                    <td>
                      <input
                        className="input-mobile border rounded-xl p-2 w-28"
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 300"
                        value={priceDraftById[r.id] ?? (Number.isFinite(r.buyPrice) ? String(r.buyPrice) : "")}
                        disabled={submitted || r.locked}
                        onChange={(e) => {
                          if (submitted || r.locked) return;
                          const raw = e.target.value;
                          if (raw === "") {
                            setPriceDraftById((prev) => ({ ...prev, [r.id]: raw }));
                            updateRow(r.id, { buyPrice: 0 });
                            return;
                          }
                          if (!/^\d*(?:[.,]\d*)?$/.test(raw)) return;
                          setPriceDraftById((prev) => ({ ...prev, [r.id]: raw }));
                          const n = toNumStr(raw);
                          const final = n < 0 ? 0 : n;
                          updateRow(r.id, { buyPrice: final });
                        }}
                        onBlur={(e) => {
                          if (submitted || r.locked) return;
                          const n = toNumStr(e.target.value);
                          const final = n < 0 ? 0 : n;
                          updateRow(r.id, { buyPrice: final });
                          setPriceDraftById((prev) => {
                            if (!(r.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[r.id];
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="font-medium">
                      {fmt(line)}
                      {sell > 0 && (
                        <div className={`text-xs mt-0.5 ${marginPerUnit < 0 ? "text-red-700" : "text-gray-500"}`}>
                          Sell: Ksh {fmt(sell)} • Margin/unit: {marginPerUnit >= 0 ? "+" : ""}{fmt(marginPerUnit)}
                        </div>
                      )}
                    </td>
                    <td>
                      {r.locked ? (
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-gray-500">Locked. Request supervisor change if needed.</span>
                          <button
                            className="btn-mobile text-xs border rounded-lg px-2 py-1"
                            onClick={() => requestRowModification(r)}
                          >
                            Request change
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            className="btn-mobile text-xs border rounded-lg px-2 py-1"
                            onClick={() => { void submitRow(r); }}
                          >
                            Submit
                          </button>
                          <button
                            className="btn-mobile text-xs border rounded-lg px-2 py-1"
                            onClick={() => requestRowModification(r)}
                          >
                            Request change
                          </button>
                          {!submitted && (
                            <button
                              className="btn-mobile text-xs border rounded-lg px-2 py-1"
                              onClick={() => removeRow(r.id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-2 font-semibold" colSpan={4}>
                  Totals
                </td>
                <td className="font-semibold">{fmt(totals.totalBuy)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 mobile-scroll-x">
          <button className="btn-mobile border rounded-xl px-3 py-1 text-xs" onClick={printSummary}>
            Print
          </button>
          <button className="btn-mobile border rounded-xl px-3 py-1 text-xs" onClick={requestModification}>
            Request Modification
          </button>
        </div>
        {/* Sticky action bar on mobile */}
        <div className="sm:hidden sticky-save-bottom mt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/80">Supply ready?</span>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold" onClick={() => void saveDraft()} disabled={!selectedOutletName}>
                Save
              </button>
              <button className="px-3 py-2 rounded-lg bg-white/10 text-white ring-1 ring-white/20 text-sm" onClick={downloadPdfReport} disabled={!selectedOutletName}>
                PDF
              </button>
              <button className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold" onClick={submitDay} disabled={!selectedOutletName}>
                Submit
              </button>
            </div>
          </div>
        </div>

        {submitted && (
          <p className="text-xs text-green-700 mt-2">
            Submitted and locked. Supervisor can adjust later if needed.
          </p>
        )}
        </section>
      )}

      {/* Pricebook tab */}
      {tab === 'pricebook' && (
        <section id="supplier-pricebook" className="rounded-2xl border p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Outlet Pricebook — {selectedOutletName || "—"}</h2>
          </div>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Product</th>
                  <th>Key</th>
                  <th>Sell Price (Ksh)</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {pricesError && (
                  <tr><td className="py-2 text-red-700" colSpan={4}>{pricesError}</td></tr>
                )}
                {!pricesError && prices.length === 0 && (
                  <tr><td className="py-2 text-gray-500" colSpan={4}>No products.</td></tr>
                )}
                {prices.map((p, i) => (
                  <tr key={`${p.key}-${i}`} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td><code className="text-xs px-1 py-0.5 rounded bg-white/10 text-white">{p.key}</code></td>
                    <td>Ksh {fmt(Number(p.price) || 0)}</td>
                    <td>{p.active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">Auto-refreshes every 5s.</p>
        </section>
      )}

      {/* Transfers tab */}
      {tab === 'transfers' && (
        <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-semibold mb-2">Transfers (Between Outlets) — {dateStr}</h2>

        <div className="grid md:grid-cols-5 gap-2 mb-3 mobile-scroll-x">
          <select
            className="input-mobile border rounded-xl p-2 text-sm"
            value={txFromId}
            onChange={(e) => setTxFromId(e.target.value)}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                From: {o.name}
              </option>
            ))}
          </select>

    <select
      className="input-mobile border rounded-xl p-2 text-sm"
            value={txToId}
            onChange={(e) => setTxToId(e.target.value)}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                To: {o.name}
              </option>
            ))}
          </select>

          <select
            className="input-mobile border rounded-xl p-2 text-sm"
            value={txProductKey}
            onChange={(e) => setTxProductKey(e.target.value)}
          >
            <option value="">Product…</option>
            {products
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                </option>
              ))}
          </select>

          <input
            className="input-mobile border rounded-xl p-2 text-sm"
            type="text"
            inputMode={productByKey[txProductKey]?.unit === "kg" ? "decimal" : "numeric"}
            placeholder="Qty"
            value={txQty}
            onChange={(e) => setTxQty(e.target.value)}
            onBlur={() => {
              const p = productByKey[txProductKey];
              const unit = p?.unit ?? "kg";
              const n = toNumStr(txQty);
              setTxQty(normalizeQtyForInput(n, unit, p?.key ?? null));
            }}
          />

          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addTransfer}>
            Save Transfer
          </button>
        </div>

        <div className="table-wrap">
          <table className="w-full text-sm">
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
              {transfers.length === 0 ? (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={6}>
                    No transfers for this date.
                  </td>
                </tr>
              ) : (
                transfers.map((t) => {
                  const name = productByKey[t.itemKey]?.name ?? t.itemKey;
                  return (
                    <tr key={t.id} className="border-b">
                      <td className="p-2">{t.date}</td>
                      <td className="p-2">{t.fromOutletName}</td>
                      <td className="p-2">{t.toOutletName}</td>
                      <td className="p-2">{name}</td>
                      <td className="p-2 font-medium">{fmt(t.qty)}</td>
                      <td className="p-2">{t.unit}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-600 mt-2">
          Transfers update the “Opening Supply” of both outlets for this date. Attendants will see the effect when they record closing.
        </p>
        </section>
      )}

      {/* Disputes tab */}
      {tab === 'disputes' && (
        <section className="rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Disputes for {selectedOutletName || "—"}</h2>
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Date</th>
                <th>Type</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Description</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {amends.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={7}>No disputes.</td>
                </tr>
              ) : amends.map(a => (
                <tr key={a.id} className="border-b">
                  <td className="py-2">{a.date}</td>
                  <td>{a.type || "-"}</td>
                  <td>{a.itemKey || "-"}</td>
                  <td>{typeof a.qty === "number" ? fmt(a.qty) : "-"}</td>
                  <td className="max-w-[28rem] truncate" title={a.description || ""}>{a.description || "-"}</td>
                  <td>{a.status || "-"}</td>
                  <td>
                    <button className="text-xs border rounded-lg px-2 py-1" onClick={() => addAmendComment(a.id)}>
                      Add reason
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          You can add comments/reasons. Only the Supervisor can approve/reject disputes.
        </p>
        </section>
      )}

      <footer className="mt-6 text-xs text-gray-600">
        Tip: Complete supplies and transfers <span className="font-medium">before</span> attendants start closing. Use
        “Submit & Lock” when done; contact Supervisor for corrections.
      </footer>
    </main>
  );
}

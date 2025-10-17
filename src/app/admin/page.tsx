// src/app/admin/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { hydrateLocalStorageFromDB, pushLocalStorageKeyToDB, pushAllToDB } from "@/lib/settingsBridge";
import { canonFull } from "@/lib/codeNormalize";
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON, removeItem as lsRemoveItem } from "@/utils/safeStorage";

/** =============== Types =============== */
type Unit = "kg" | "pcs";

type Product = {
  id: string;
  key: string;         // stable key used by other pages, e.g. "beef"
  name: string;
  unit: Unit;
  sellPrice: number;   // Ksh per unit (used by Attendant expected Ksh)
  active: boolean;
};

type Outlet = {
  id: string;
  name: string;        // "Bright", "Baraka A", ...
  code: string;        // e.g. "BR1234"
  active: boolean;
};

type FixedExpense = {
  id: string;
  name: string;        // "Rent", "Electricity", ...
  amount: number;      // Ksh
  frequency: "daily" | "weekly" | "monthly";
  active: boolean;
};

type AdminTab =
  | "outlets"
  | "pricing"
  | "ops"
  | "expenses"
  | "performance"
  | "data";

/** People & Codes */
type PersonCode = {
  id: string;
  name: string;
  code: string;
  role: "attendant" | "supervisor" | "supplier";
  active: boolean;
  // Optional payroll fields (attendants only)
  salaryAmount?: number;
  salaryFrequency?: "daily" | "weekly" | "monthly";
};

/** Attendant scope (code -> outlet + product keys) */
type ScopeMap = Record<string, { outlet: string; productKeys: string[] }>;

/** per-outlet pricebook */
type PriceBook = Record<
  string, // outlet name
  Record<
    string, // product key
    { sellPrice: number; active: boolean }
  >
>;

/** =============== Storage Keys =============== */
const K_OUTLETS   = "admin_outlets";
const K_PRODUCTS  = "admin_products";
const K_EXPENSES  = "admin_expenses";
const K_CODES     = "admin_codes";
const K_SCOPE     = "attendant_scope";
const K_PRICEBOOK = "admin_pricebook";

/** =============== Cross-page dynamic keys (read-only here) =============== */
const supplierOpeningKey = (date: string, outlet: string) =>
  `supplier_opening_${date}_${outlet}`;
const supplierCostKey = (date: string, outlet: string) =>
  `supplier_cost_${date}_${outlet}`;

const summaryKey = (date: string, outlet: string) =>
  `attendant_summary_${date}_${outlet}`;
const attClosingKey = (date: string, outlet: string) =>
  `attendant_closing_${date}_${outlet}`;
const attWasteKey = (date: string, outlet: string) =>
  `attendant_waste_${date}_${outlet}`;
const expensesKeyDyn = (date: string, outlet: string) =>
  `attendant_expenses_${date}_${outlet}`;

const AMEND_REQUESTS_KEY = "amend_requests";

/** =============== Defaults =============== */
function seedDefaultOutlets(): Outlet[] {
  return [
    { id: rid(), name: "Bright",   code: "BR1234", active: true },
    { id: rid(), name: "Baraka A", code: "A1234",  active: true },
    { id: rid(), name: "Baraka B", code: "B1234",  active: true },
    { id: rid(), name: "Baraka C", code: "C1234",  active: true },
  ];
}
function seedDefaultProducts(): Product[] {
  return [
    { id: rid(), key: "beef",      name: "Beef",            unit: "kg",  sellPrice: 740, active: true },
    { id: rid(), key: "goat",      name: "Goat (Cigon)",    unit: "kg",  sellPrice: 900, active: true },
    { id: rid(), key: "liver",     name: "Liver",           unit: "kg",  sellPrice: 900, active: true },
    { id: rid(), key: "kuku",      name: "Kuku (Chicken)",  unit: "kg",  sellPrice: 900, active: true },
    { id: rid(), key: "matumbo",   name: "Matumbo",         unit: "kg",  sellPrice: 0,   active: true },
    { id: rid(), key: "potatoes",  name: "Potatoes (raw)",  unit: "kg",  sellPrice: 150, active: true },
    { id: rid(), key: "samosas",   name: "Samosas",         unit: "pcs", sellPrice: 60,  active: true },
    { id: rid(), key: "mutura",    name: "Mutura",          unit: "pcs", sellPrice: 60,  active: true },
  ];
}
function seedDefaultExpenses(): FixedExpense[] {
  return [
    { id: rid(), name: "Wages",       amount: 0,  frequency: "monthly", active: true },
    { id: rid(), name: "Rent",        amount: 0,  frequency: "monthly", active: true },
    { id: rid(), name: "Electricity", amount: 0,  frequency: "monthly", active: true },
    { id: rid(), name: "Water",       amount: 0,  frequency: "monthly", active: false },
  ];
}

/** =============== Page =============== */
export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---------- warm welcome (kept) ----------
  const [welcome, setWelcome] = useState<string>("");
  useEffect(() => {
    const msg = sessionStorage.getItem("admin_welcome");
    if (msg) setWelcome(msg);
  }, []);

  const [tab, setTab] = useState<AdminTab>("outlets");
  const [pricingView, setPricingView] = useState<"global" | "outlet">("global");
  // Respect URL ?tab=... and ?opsTab=... on load
  useEffect(() => {
    const t = (searchParams.get("tab") || "").toLowerCase();
    // Back-compat: map legacy tabs to the new combined Pricing tab
    if (t === "products") { setTab("pricing"); setPricingView("global"); }
    else if (t === "pricebook") { setTab("pricing"); setPricingView("outlet"); }
    else {
      const allowedTabs = new Set<AdminTab>(["outlets","pricing","ops","expenses","performance","data"]);
      if (allowedTabs.has(t as AdminTab)) {
        setTab(t as AdminTab);
      }
    }
    // Optional deep-link: ?pricing=global|outlet
    const pv = (searchParams.get("pricing") || "").toLowerCase();
    if (pv === "global" || pv === "outlet") {
      setTab("pricing");
      setPricingView(pv as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const opsTabFromURL = useMemo<"supply"|"reports"|"history"|undefined>(() => {
    const o = (searchParams.get("opsTab") || "").toLowerCase();
    return o === "supply" || o === "reports" || o === "history" ? (o as any) : undefined;
  }, [searchParams]);

  const [outlets, setOutlets]   = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);
  const [codes, setCodes]       = useState<PersonCode[]>([]);
  const [scope, setScope]       = useState<ScopeMap>({});
  const [pricebook, setPricebook] = useState<PriceBook>({});
  const [hydrated, setHydrated] = useState(false); // <<< NEW: prevents autosave writing {} before load
  const [savingOutlets, setSavingOutlets] = useState(false);

  // WhatsApp phones mapping state (code -> phone E.164)
  const [phones, setPhones] = useState<Record<string, string>>({});
  // Admin WhatsApp phone
  const [adminPhone, setAdminPhone] = useState<string>("");
  // Low-stock thresholds (productKey -> min qty)
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [loadingThresholds, setLoadingThresholds] = useState<boolean>(false);

  const normalizeOutletList = useCallback((list: any[]): Outlet[] => {
    const rows = Array.isArray(list) ? list : [];
    return rows
      .filter((row) => row && typeof row.name === "string")
      .map((row: any) => ({
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : rid(),
        name: String(row.name || "").trim(),
        code: typeof row.code === "string" ? row.code.trim().toUpperCase() : "",
        active: row?.active === false ? false : true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const refreshOutletsFromServer = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/outlets/list", { cache: "no-store" });
      if (!response.ok) {
        const text = await response.text().catch(() => "Failed to fetch outlets");
        throw new Error(text || "Failed to fetch outlets");
      }
      const data = await response.json().catch(() => ({}));
      const next = normalizeOutletList((data as any)?.outlets);
      setOutlets(next);
      saveLS(K_OUTLETS, next);
      return next;
    } catch (err) {
      console.error("Failed to refresh outlets from server", err);
      throw err;
    }
  }, [normalizeOutletList]);

  const refreshScopeFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/assignments/list", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json().catch(() => null as any);
      const map = (j && typeof j === "object" && j.scope && typeof j.scope === "object") ? (j.scope as ScopeMap) : {};
      setScope(map);
      saveLS(K_SCOPE, map);
      return map;
    } catch {
      // best-effort
      return null;
    }
  }, []);

  const payload = useMemo(
    () => JSON.stringify({ outlets, products, expenses, codes, scope, pricebook }, null, 2),
    [outlets, products, expenses, codes, scope, pricebook]
  );
  const [importText, setImportText] = useState("");

  /** ----- Load once ----- */
  useEffect(() => {
    (async () => {
      try {
        // 1) DB-first: try relational bootstrap first
        let bootstrapped = false;
        try {
          const r = await fetch("/api/admin/bootstrap", { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            if (j) {
              if (j.outlets)   { safeWriteJSON("admin_outlets", j.outlets);   bootstrapped = true; }
              if (j.products)  { safeWriteJSON("admin_products", j.products); bootstrapped = true; }
              if (j.codes)     { safeWriteJSON("admin_codes", j.codes);       bootstrapped = true; }
              if (j.scope)     { safeWriteJSON("attendant_scope", j.scope);   bootstrapped = true; }
              if (j.pricebook) { safeWriteJSON("admin_pricebook", j.pricebook); bootstrapped = true; }
            }
          }
        } catch {}

        // 2) Fallback: hydrate thin settings if bootstrap didn’t fill
        if (!bootstrapped) {
          try { await hydrateLocalStorageFromDB(); } catch {}
        }

        // 3) Read from localStorage into state
        const o = parseLS<Outlet[]>(K_OUTLETS) ?? seedDefaultOutlets();
        const p = parseLS<Product[]>(K_PRODUCTS) ?? seedDefaultProducts();
        const e = parseLS<FixedExpense[]>(K_EXPENSES) ?? seedDefaultExpenses();
        const c = parseLS<PersonCode[]>(K_CODES) ?? [];
        const s = parseLS<ScopeMap>(K_SCOPE) ?? {};
        const pb = parseLS<PriceBook>(K_PRICEBOOK) ?? {};
        setOutlets(o); setProducts(p); setExpenses(e);
        setCodes(c); setScope(s); setPricebook(pb);
      } catch {
        setOutlets(seedDefaultOutlets());
        setProducts(seedDefaultProducts());
        setExpenses(seedDefaultExpenses());
        setCodes([]); setScope({}); setPricebook({});
      } finally {
        setHydrated(true); // mark as loaded
        try {
          await refreshOutletsFromServer();
        } catch {}
        try {
          await refreshScopeFromServer();
        } catch {}
      }
    })();
  }, []);

  // Load current phone mappings (once)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/phones", { cache: "no-store" });
        if (r.ok) {
          const list = (await r.json()) as Array<{ code: string; phoneE164: string }>;
          const m: Record<string, string> = {};
          list.forEach((row) => { if (row?.code) m[row.code] = row.phoneE164 || ""; });
          setPhones(m);
        }
      } catch {}
    })();
  }, []);

  // Load admin phone mapping once (role=admin, code=ADMIN)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/phones", { cache: "no-store" });
        if (r.ok) {
          const list = (await r.json()) as Array<{ code: string; phoneE164: string }>;
          const row = list.find(x => x.code === "ADMIN");
          if (row?.phoneE164) setAdminPhone(row.phoneE164);
        }
      } catch {}
    })();
  }, []);

  // Load Low-stock thresholds (once; can be refreshed)
  const refreshThresholds = async () => {
    setLoadingThresholds(true);
    try {
      const r = await fetch("/api/admin/low-stock-thresholds", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { ok: boolean; thresholds: Record<string, number> | null };
        setThresholds(j?.thresholds || {});
      }
    } catch {}
    finally { setLoadingThresholds(false); }
  };
  useEffect(() => { refreshThresholds(); }, []);

  /** ----- Explicit save buttons (unchanged) ----- */
  const saveOutletsNow = async () => {
    if (!hydrated) {
      alert("Still loading outlet data. Please try again in a moment.");
      return;
    }
    if (savingOutlets) return;

    const payload = outlets.map((o) => {
      const name = (o.name || "").trim();
      const code = typeof o.code === "string" ? o.code.trim() : "";
      return {
        id: typeof o.id === "string" && /^c[a-z0-9]{24}$/i.test(o.id) ? o.id : undefined,
        name,
        code,
        active: o.active !== false,
      };
    });

    if (payload.length === 0) {
      alert("Add at least one outlet before saving.");
      return;
    }
    if (payload.some((row) => !row.name)) {
      alert("Every outlet needs a name before saving.");
      return;
    }

    setSavingOutlets(true);
    try {
      const response = await fetch("/api/admin/outlets/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ outlets: payload }),
      });
      const textBody = await response.text();
      let json: any = null;
      try { json = JSON.parse(textBody); } catch {}
      if (!response.ok || !json?.ok) {
        const message = json?.error || textBody || "Failed to save outlets";
        throw new Error(message);
      }
      if (Array.isArray(json?.outlets)) {
        const next = normalizeOutletList(json.outlets);
        setOutlets(next);
        saveLS(K_OUTLETS, next);
      } else {
        await refreshOutletsFromServer().catch(() => {});
      }
      alert("Outlets & Codes saved ✅");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Failed to save outlets: ${message}`);
    } finally {
      setSavingOutlets(false);
    }
  };
  const saveProductsNow = async () => { saveLS(K_PRODUCTS, products); await pushLocalStorageKeyToDB(K_PRODUCTS as any); alert("Products & Prices saved ✅"); };
  const saveExpensesNow = async () => { saveLS(K_EXPENSES, expenses); await pushLocalStorageKeyToDB(K_EXPENSES as any); alert("Fixed Expenses saved ✅"); };
  const saveCodesNow    = async () => {
    const payload = codes
      .filter((c) => typeof c.code === 'string' && c.code.trim().length > 0)
      .map((c) => ({
        role: c.role,
        code: c.code.trim(),
        name: c.name,
        active: c.active,
        ...(c.role === "attendant" ? {
          salaryAmount: typeof c.salaryAmount === 'number' ? c.salaryAmount : undefined,
          salaryFrequency: c.salaryFrequency,
        } : {}),
      }));
    if (!payload.length) {
      alert('Add at least one code before saving.');
      return;
    }

    saveLS(K_CODES, codes);

    try {
      const res = await fetch('/api/admin/attendants/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ people: payload }),
      });
      const textBody = await res.text();
      let json: any = null;
      try { json = JSON.parse(textBody); } catch {}
      if (!res.ok || !json?.ok) {
        const message = json?.error || textBody || 'Failed to save codes';
        throw new Error(message);
      }

      try { await hydrateLocalStorageFromDB([K_CODES as any]); } catch {}
      const refreshed = parseLS<PersonCode[]>(K_CODES) ?? payload;

      const byNorm = new Map<string, PersonCode>();
      codes.forEach((item) => {
        const key = normCode(item.code);
        if (key) byNorm.set(key, item);
      });

      const normalized = refreshed.map((row: any) => {
        const key = normCode(row?.code || '');
        const prev = key ? byNorm.get(key) : undefined;
        return {
          id: prev?.id ?? rid(),
          name: typeof row?.name === 'string' ? row.name : '',
          code: typeof row?.code === 'string' ? row.code : '',
          role: row?.role === 'supervisor' || row?.role === 'supplier' ? row.role : 'attendant',
          active: row?.active === false ? false : true,
          salaryAmount: typeof row?.salaryAmount === 'number' ? row.salaryAmount : prev?.salaryAmount,
          salaryFrequency: typeof row?.salaryFrequency === 'string' ? (row.salaryFrequency as any) : prev?.salaryFrequency,
        } as PersonCode;
      });

      setCodes(normalized);
      setScope((prev) => {
        const allow = new Set(normalized.map((c) => normCode(c.code)));
        const next: ScopeMap = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (allow.has(key)) next[key] = value;
        });
        return next;
      });
      saveLS(K_CODES, normalized);
      try { await refreshScopeFromServer(); } catch {}
      alert('People & Codes saved ✅');
    } catch (err) {
      console.error('save codes error', err);
      alert('Failed to sync People & Codes to server');
    }
  };
  // Push assignments to relational store
  const pushAssignmentsToDB = async (map: ScopeMap) => {
    const res = await fetch("/api/admin/scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(map),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok || !json?.ok) {
      if (json?.error === 'product_conflict' && Array.isArray(json?.conflicts)) {
        const lines = json.conflicts.map((c: any) => `- ${c.productKey} @ ${c.outlet} already assigned to ${c.holderCode}`);
        throw new Error(`Conflicts detected:\n${lines.join("\n")}`);
      }
      throw new Error(json?.error || text || 'Failed to save assignments');
    }
    return json as { ok: boolean; count: number };
  };

  const saveScopesNow   = async () => {
    // 1) Persist to localStorage for offline safety
    saveLS(K_SCOPE, scope);
    try { await pushLocalStorageKeyToDB(K_SCOPE as any); } catch {}

    // 2) Write-through to server AttendantAssignment
    try {
      const r = await pushAssignmentsToDB(scope);
      try { await refreshScopeFromServer(); } catch {}
      alert(`Assignments saved to server ✅ (rows: ${r.count})`);
    } catch (e: any) {
      const msg = e?.message || String(e) || 'Saved locally, but failed to sync assignments to server.';
      alert(msg);
    }
  };

  /** Phones mapping upsert (server write-through) */
  const savePhoneFor = async (code: string, role: PersonCode["role"], outletName?: string) => {
    const norm = canonFull(code || "");
    const phone = (phones[norm] || "").trim();
    if (!code || !phone) { alert("Missing code or phone"); return; }
    const payload = { code: norm, role, phoneE164: phone, outlet: outletName };
  const r = await fetch("/api/admin/phones", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(await r.text());
  };
  const saveAllPhones = async () => {
    try {
      const codeToOutlet: Record<string, string | undefined> = {};
      // Resolve outlet for attendants via scope
      Object.keys(phones).forEach((code) => {
        const norm = canonFull(code);
        codeToOutlet[norm] = scope[norm]?.outlet;
      });
      for (const c of codes) {
        const code = (c.code || "").trim();
        if (!code) continue;
        const norm = canonFull(code);
        const phone = (phones[norm] || "").trim();
        if (!phone) continue;
        await savePhoneFor(norm, c.role, codeToOutlet[norm]);
      }
      alert("Phone mappings saved ✅");
    } catch {
      alert("Failed to save one or more phone mappings");
    }
  };

  const saveAdminPhone = async () => {
    try {
      const phone = adminPhone.trim();
      if (!phone) { alert("Enter admin WhatsApp phone"); return; }
      const r = await fetch("/api/admin/phone", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ role: "admin", code: "ADMIN", phoneE164: phone }) });
      if (!r.ok) throw new Error(await r.text());
      alert("Admin WhatsApp saved ✅");
    } catch { alert("Failed to save admin WhatsApp"); }
  };
  const saveThresholds = async () => {
    try {
      // Persist only numeric values (including 0 if explicitly set)
      const body: Record<string, number> = {};
      Object.keys(thresholds).forEach((k) => {
        const v = thresholds[k];
        if (typeof v === "number" && !Number.isNaN(v)) body[k] = v;
      });
      const r = await fetch("/api/admin/low-stock-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ thresholds: body }),
      });
      if (!r.ok) throw new Error(await r.text());
      alert("Thresholds saved ✅");
    } catch {
      alert("Failed to save thresholds");
    }
  };
  const resetThresholdsToSystemDefaults = async () => {
    try {
  const r = await fetch("/api/admin/low-stock-thresholds", { method: "DELETE", cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      setThresholds({});
      alert("Reset to system defaults ✅");
    } catch {
      alert("Failed to reset thresholds");
    }
  };
  const importJSON = () => {
    try {
      const obj = JSON.parse(importText || "{}");
      if (obj && typeof obj === "object") {
        if (K_OUTLETS in obj) saveLS(K_OUTLETS, (obj as any)[K_OUTLETS]);
        if (K_PRODUCTS in obj) saveLS(K_PRODUCTS, (obj as any)[K_PRODUCTS]);
        if (K_EXPENSES in obj) saveLS(K_EXPENSES, (obj as any)[K_EXPENSES]);
        if (K_CODES in obj) saveLS(K_CODES, (obj as any)[K_CODES]);
        if (K_SCOPE in obj) saveLS(K_SCOPE, (obj as any)[K_SCOPE]);
        if (K_PRICEBOOK in obj) saveLS(K_PRICEBOOK, (obj as any)[K_PRICEBOOK]);
        alert("Imported. Reload to see changes.");
      }
    } catch {
      alert("Invalid JSON. Please check and try again.");
    }
  };
  const savePricebook   = async () => {
    saveLS(K_PRICEBOOK, pricebook);
    try { await pushLocalStorageKeyToDB(K_PRICEBOOK as any); } catch {}
  try { await fetch("/api/admin/save-scope-pricebook", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ scope: {}, pricebook }) }); } catch {}
    alert("Outlet pricebook saved ✅");
  };

  /** ----- Autosave so settings persist immediately (guarded) ----- */
  useEffect(() => { if (hydrated) saveLS(K_PRICEBOOK, pricebook); }, [hydrated, pricebook]); // <<< gated
  useEffect(() => { if (hydrated) saveLS(K_SCOPE, scope);         }, [hydrated, scope]);     // <<< gated

  /** ----- CRUD helpers ----- */
  // Extracted persist helpers so delete actions can save immediately
  const persistOutlets = useCallback(async (nextOutlets: Outlet[]) => {
    const payload = nextOutlets.map((o) => ({
      id: typeof o.id === "string" && /^c[a-z0-9]{24}$/i.test(o.id) ? o.id : undefined,
      name: (o.name || "").trim(),
      code: typeof o.code === "string" ? o.code.trim() : "",
      active: o.active !== false,
    }));
    const response = await fetch("/api/admin/outlets/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ outlets: payload }),
    });
    const textBody = await response.text();
    let json: any = null; try { json = JSON.parse(textBody); } catch {}
    if (!response.ok || !json?.ok) {
      const message = json?.error || textBody || "Failed to save outlets";
      throw new Error(message);
    }
    if (Array.isArray(json?.outlets)) {
      const next = normalizeOutletList(json.outlets);
      setOutlets(next);
      saveLS(K_OUTLETS, next);
    } else {
      await refreshOutletsFromServer().catch(() => {});
    }
  }, [normalizeOutletList, refreshOutletsFromServer]);

  const persistCodes = useCallback(async (nextCodes: PersonCode[]) => {
    const payload = nextCodes
      .filter((c) => typeof c.code === 'string' && c.code.trim().length > 0)
      .map((c) => ({
        role: c.role,
        code: c.code.trim(),
        name: c.name,
        active: c.active,
        ...(c.role === "attendant" ? {
          salaryAmount: typeof c.salaryAmount === 'number' ? c.salaryAmount : undefined,
          salaryFrequency: c.salaryFrequency,
        } : {}),
      }));
    saveLS(K_CODES, nextCodes);
    const res = await fetch('/api/admin/attendants/upsert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ people: payload })
    });
    const txt = await res.text();
    let j: any = null; try { j = JSON.parse(txt); } catch {}
    if (!res.ok || !j?.ok) throw new Error(j?.error || txt || 'Failed to save codes');
    setCodes(nextCodes);
  }, []);

  // Outlets
  const addOutlet = () => setOutlets(v => [...v, { id: rid(), name: "", code: "", active: true }]);
  const removeOutlet = async (id: string) => {
    const row = outlets.find(o => o.id === id);
    const name = row?.name || 'this outlet';
    if (!confirm(`Delete ${name}? It will be removed from the database (or deactivated if referenced).`)) return;
    const next = outlets.filter(x => x.id !== id);
    setOutlets(next);
    try { await persistOutlets(next); } catch (e) {
      console.error('delete outlet failed', e);
      alert(`Failed to delete outlet: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };
  const updateOutlet = (id: string, patch: Partial<Outlet>) =>
    setOutlets(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  // Products
  const addProduct = () => setProducts(v => [...v, { id: rid(), key: "", name: "", unit: "kg", sellPrice: 0, active: true }]);
  const removeProduct = (id: string) => setProducts(v => v.filter(x => x.id !== id));
  const updateProduct = (id: string, patch: Partial<Product>) =>
    setProducts(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  // Expenses
  const addExpense = () => setExpenses(v => [...v, { id: rid(), name: "", amount: 0, frequency: "monthly", active: true }]);
  const removeExpense = (id: string) => setExpenses(v => v.filter(x => x.id !== id));
  const updateExpense = (id: string, patch: Partial<FixedExpense>) =>
    setExpenses(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  /** People & Codes CRUD */
  const addCode = () =>
    setCodes(v => [{ id: rid(), name: "", code: "", role: "attendant", active: true }, ...v]);
  const removeCode = async (id: string) => {
    const row = codes.find(c => c.id === id);
    const label = row?.code ? `${row.code} (${row?.name || ''})` : 'this code';
    if (!confirm(`Delete ${label}? This removes the code from database and related mappings.`)) return;
    // Server-side single delete
    try {
      const res = await fetch('/api/admin/attendants/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ code: row?.code || '' }),
      });
      const txt = await res.text();
      let j: any = null; try { j = JSON.parse(txt); } catch {}
      if (!res.ok || !j?.ok) throw new Error(j?.error || txt || 'Failed');
    } catch (e) {
      console.error('delete code failed', e);
      alert(`Failed to delete code: ${e instanceof Error ? e.message : 'Unknown error'}`);
      return;
    }
    // Local update after server success
    const next = codes.filter(c => c.id !== id);
    setCodes(next);
    saveLS(K_CODES, next);
  };
  const updateCode = (id: string, patch: Partial<PersonCode>) =>
    setCodes(v => v.map(c => (c.id === id ? { ...c, ...patch } : c)));

  /** ----- Assignments (Attendants) ----- */
  const activeOutlets = useMemo(() => outlets.filter(o => o.active), [outlets]);
  const activeProducts = useMemo(() => products.filter(p => p.active), [products]);
  const attendantCodes = useMemo(() => codes.filter(c => c.role === "attendant"), [codes]);

  const normCode = (c: string) => canonFull(c);

  const setScopeOutlet = (code: string, outletName: string) => {
    const key = normCode(code || "");
    if (!key) return;
    setScope(prev => {
      const next = { ...prev };
      const entry = next[key] ?? { outlet: outletName, productKeys: [] as string[] };
      entry.outlet = outletName;
      next[key] = { ...entry };
      return next;
    });
  };

  // Prevent duplicate product assignment in the same outlet
  const isProductTakenInOutlet = React.useCallback((outletName: string, prodKey: string, selfCode?: string) => {
    const selfKey = selfCode ? normCode(selfCode) : undefined;
    for (const [code, entry] of Object.entries(scope)) {
      if (selfKey && code === selfKey) continue;
      if (entry?.outlet === outletName && Array.isArray(entry?.productKeys) && entry.productKeys.includes(prodKey)) {
        return true;
      }
    }
    return false;
  }, [scope]);

  const toggleScopeProduct = (code: string, prodKey: string) => {
    const key = normCode(code || "");
    if (!key) return;
    setScope(prev => {
      const next = { ...prev };
      const entry = next[key] ?? { outlet: "", productKeys: [] as string[] };
      if (entry.outlet && isProductTakenInOutlet(entry.outlet, prodKey, code)) {
        return prev; // disallow selecting already taken product in same outlet
      }
      const has = entry.productKeys.includes(prodKey);
      const productKeys = has
        ? entry.productKeys.filter(k => k !== prodKey)
        : [...entry.productKeys, prodKey];
      next[key] = { ...entry, productKeys };
      return next;
    });
  };

  const clearScopeForCode = (code: string) => {
    const key = normCode(code || "");
    if (!key) return;
    setScope(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** ----- Pricebook helpers ----- */
  const [pbOutlet, setPbOutlet] = useState<string>("");

  const getPBRow = (outletName: string, key: string): { sellPrice: number; active: boolean } => {
    const fromPB = pricebook[outletName]?.[key];
    if (fromPB) return fromPB;
    const base = products.find(p => p.key === key);
    return { sellPrice: base?.sellPrice ?? 0, active: base?.active ?? true };
  };

  const setPBRow = (outletName: string, key: string, patch: Partial<{ sellPrice: number; active: boolean }>) => {
    setPricebook(prev => {
      const next = { ...prev };
      const outletPB = { ...(next[outletName] || {}) };
      const current = outletPB[key] || getPBRow(outletName, key);
      outletPB[key] = { ...current, ...patch };
      next[outletName] = outletPB;
      return next;
    });
  };

  const copyGlobalToOutlet = (outletName: string) => {
    const map: Record<string, { sellPrice: number; active: boolean }> = {};
    products.forEach(p => { map[p.key] = { sellPrice: p.sellPrice, active: p.active }; });
    setPricebook(prev => ({ ...prev, [outletName]: map }));
  };
  const resetOutletPricebook = (outletName: string) => {
    setPricebook(prev => { const next = { ...prev }; delete next[outletName]; return next; });
  };

  /** ----- Reports helpers (read-only) ----- */
  type RangeMode = "day" | "week";
  const [repDate, setRepDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [repMode, setRepMode] = useState<RangeMode>("day");

  const datesInRange = useMemo(() => (repMode === "day" ? [repDate] : getWeekDates(repDate)), [repDate, repMode]);

  const repRows = useMemo(() => {
    return outlets.map(o => {
      let expectedKsh = 0, depositedKsh = 0, expensesKsh = 0, cashAtTill = 0, varianceKsh = 0;
      let hasData = false;
      datesInRange.forEach(d => {
        const s = readJSON<{ expectedKsh:number; depositedKsh:number; expensesKsh:number; cashAtTill:number; varianceKsh:number } | null>(
          summaryKey(d, o.name), null
        );
        if (s) {
          expectedKsh += s.expectedKsh || 0;
          depositedKsh += s.depositedKsh || 0;
          expensesKsh += s.expensesKsh || 0;
          cashAtTill  += s.cashAtTill  || 0;
          varianceKsh += s.varianceKsh || 0;
          hasData = true;
        }
      });
      return { outlet: o.name, expectedKsh, depositedKsh, expensesKsh, cashAtTill, varianceKsh, hasData };
    });
  }, [outlets, datesInRange]);

  const repTotals = useMemo(() => {
    return repRows.reduce(
      (a,r)=>({
        expectedKsh: a.expectedKsh + r.expectedKsh,
        depositedKsh: a.depositedKsh + r.depositedKsh,
        expensesKsh: a.expensesKsh + r.expensesKsh,
        cashAtTill: a.cashAtTill + r.cashAtTill,
        varianceKsh: a.varianceKsh + r.varianceKsh
      } ),
      { expectedKsh:0, depositedKsh:0, expensesKsh:0, cashAtTill:0, varianceKsh:0 }
    );
  }, [repRows]);

  const salesByItem = useMemo(() => {
    const m = new Map<string, { name: string; unit: Unit; soldQty: number; wasteQty: number; revenue: number }>();
    datesInRange.forEach(d => {
      outlets.forEach(o => {
        const openingArr = readJSON<Array<{ itemKey: string; qty: number }>>(supplierOpeningKey(d, o.name), []);
        const closingMap = readJSON<Record<string, number>>(attClosingKey(d, o.name), {});
        const wasteMap   = readJSON<Record<string, number>>(attWasteKey(d, o.name), {});
        openingArr.forEach(row => {
          const prod = products.find(p => p.key === row.itemKey);
          const unit = (prod?.unit ?? "kg") as Unit;
          const price = prod?.sellPrice ?? 0;
          const closing = Number(closingMap[row.itemKey] || 0);
          const waste = Number(wasteMap[row.itemKey] || 0);
          const sold = Math.max(0, Number(row.qty || 0) - closing - waste);
          const rec = m.get(row.itemKey) || { name: prod?.name ?? row.itemKey, unit, soldQty: 0, wasteQty: 0, revenue: 0 };
          rec.soldQty  += sold;
          rec.wasteQty += waste;
          rec.revenue  += sold * price;
          m.set(row.itemKey, rec);
        });
      });
    });
    return Array.from(m.entries()).map(([key, v]) => ({ key, ...v }));
  }, [datesInRange, outlets, products]);

  const expensesMonitor = useMemo(() => {
    const perOutlet = outlets.map(o => {
      let total = 0;
      datesInRange.forEach(d => {
        const list = readJSON<Array<{ name: string; amount: number }>>(expensesKeyDyn(d, o.name), []);
        total += list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
      });
      return { outlet: o.name, total };
    });
    const totalAll = perOutlet.reduce((a, r) => a + r.total, 0);
    return { perOutlet, totalAll };
  }, [datesInRange, outlets]);

  const supplyCost = useMemo(() => {
    let totalQty = 0, totalAmount = 0;
    const perItem = new Map<string, { qty: number; amount: number }>();
    datesInRange.forEach(d => {
      outlets.forEach(o => {
        const open = readJSON<Array<{ itemKey: string; qty: number }>>(supplierOpeningKey(d, o.name), []);
        const costMap = readJSON<Record<string, number>>(supplierCostKey(d, o.name), {});
        open.forEach(r => {
          const qty = Number(r.qty || 0);
          const price = Number(costMap[r.itemKey] || 0);
          const amt = qty * price;
          totalQty += qty; totalAmount += amt;
          const prev = perItem.get(r.itemKey) || { qty: 0, amount: 0 };
          prev.qty += qty; prev.amount += amt;
          perItem.set(r.itemKey, prev);
        });
      });
    });
    const byItem = Array.from(perItem.entries()).map(([key, v]) => {
      const p = products.find(pp => pp.key === key);
      const unit = (p?.unit ?? "kg") as Unit;
      return { key, name: p?.name ?? key, unit, qty: v.qty, avgPrice: v.qty > 0 ? v.amount / v.qty : 0, amount: v.amount };
    });
    return { totalQty, totalAmount, byItem };
  }, [datesInRange, outlets, products]);

  const profitEstimate = useMemo(() => {
    const revenue = salesByItem.reduce((a, r) => a + r.revenue, 0);
    const expensesTotal = expensesMonitor.totalAll;
    const supplyTotal = supplyCost.totalAmount;
    const grossProfit = revenue - supplyTotal;
    const netAfterExpenses = grossProfit - expensesTotal;
    return { revenue, supplyTotal, expensesTotal, grossProfit, netAfterExpenses };
  }, [salesByItem, supplyCost, expensesMonitor]);

  const raiseExpenseDispute = (outletName: string) => {
    const reason = window.prompt(`Dispute/adjust expenses for ${outletName}. Reason:`, "");
    if (!reason) return;
    const req = {
      id: rid(),
      date: repDate,
      outlet: outletName,
      requestedBy: "admin",
      type: "expense",
      description: reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const list = readJSON<any[]>(AMEND_REQUESTS_KEY, []);
    saveLS(AMEND_REQUESTS_KEY, [req, ...list]);
    alert("Expense dispute sent to Supervisor.");
  };

  /** ----- Supply view (read-only) ----- */
  const [supDate, setSupDate] = useState<string>(new Date().toISOString().slice(0,10));
  const ALL = "__ALL__";
  const [supOutletName, setSupOutletName] = useState<string>(ALL);

  const supplyItems = useMemo(() => {
    const acc = new Map<string, { name: string; unit: Unit; qty: number; amount: number }>();
    const collect = (outletName: string) => {
      const open = readJSON<Array<{ itemKey: string; qty: number }>>(supplierOpeningKey(supDate, outletName), []);
      const costMap = readJSON<Record<string, number>>(supplierCostKey(supDate, outletName), {});
      open.forEach(r => {
        const prod = products.find(p => p.key === r.itemKey);
        const unit = (prod?.unit ?? "kg") as Unit;
        const price = Number(costMap[r.itemKey] || 0);
        const qty = Number(r.qty || 0);
        const amt = qty * price;
        const prev = acc.get(r.itemKey) || { name: prod?.name ?? r.itemKey, unit, qty: 0, amount: 0 };
        prev.qty += qty; prev.amount += amt;
        acc.set(r.itemKey, prev);
      });
    };
    if (supOutletName === ALL) { outlets.forEach(o => collect(o.name)); } else { collect(supOutletName); }
    const list = Array.from(acc.entries()).map(([itemKey, v]) => {
      const avg = v.qty > 0 ? v.amount / v.qty : 0;
      return { itemKey, name: v.name, unit: v.unit, qty: v.qty, buyPrice: avg, amount: v.amount };
    });
    return list.sort((a,b)=>a.name.localeCompare(b.name));
  }, [supDate, supOutletName, outlets, products]);

  const supTotals = useMemo(() => ({
    qty: supplyItems.reduce((a, r) => a + (Number(r.qty)||0), 0),
    amount: supplyItems.reduce((a, r) => a + (Number(r.amount)||0), 0),
  }), [supplyItems]);

  /** ----- Render ----- */
  return (
    <main className="mobile-container sticky-safe p-6 max-w-7xl mx-auto">
  <header className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h1 className="text-2xl font-semibold">Administrator Dashboard</h1>
          {welcome && (
            <p className="text-sm text-gray-600 mt-1">{welcome}</p>
          )}
        </div>
        {/* ✅ Logout button */}
        <button
          className="btn-mobile border rounded-xl px-3 py-2 text-sm"
          onClick={() => {
            sessionStorage.removeItem("admin_auth");
            sessionStorage.removeItem("admin_welcome");
            router.replace("/admin/login");
          }}
          title="Sign out"
        >
          Logout
        </button>
      </header>

      <nav className="flex gap-2 mb-6 mobile-scroll-x">
        <TabBtn active={tab==="outlets"}   onClick={() => setTab("outlets")}>Outlets & Codes</TabBtn>
  <TabBtn active={tab==="pricing"}  onClick={() => setTab("pricing")}>Pricing</TabBtn>
        {/* Combined Ops: Supply View, Reports, Supply History */}
        <TabBtn active={tab==="ops"}       onClick={() => setTab("ops")}>Supply & Reports</TabBtn>
    <TabBtn active={tab==="expenses"}  onClick={() => setTab("expenses")}>Fixed Expenses</TabBtn>
    {/* Performance now embedded as a tab */}
    <TabBtn active={tab==="performance"} onClick={() => setTab("performance")}>Performance</TabBtn>
    {/* Data tab contains Backup/Restore and admin tools */}
    <TabBtn active={tab==="data"}      onClick={() => setTab("data")}>Data</TabBtn>
        {/* Quick link to WhatsApp management */}
        <a href="/admin/wa-logs" className="px-3 py-2 rounded-2xl text-sm border" title="Open WhatsApp logs & sender">WhatsApp</a>
        {/* Commissions management */}
        <a href="/admin/commissions" className="px-3 py-2 rounded-2xl text-sm border" title="Supervisor commissions management & PDF">Commissions</a>
      </nav>

      {/* ---------- OUTLETS & CODES ---------- */}
      {tab === "outlets" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Outlets & Attendant Codes</h2>
            <div className="flex gap-2">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addOutlet}>+ Add outlet</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveOutletsNow} disabled={savingOutlets}>{savingOutlets ? "Saving..." : "Submit / Save"}</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={() => setOutlets(seedDefaultOutlets())}>
                Reset defaults
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Login Code (legacy, optional)</th>
                  <th>Status</th>
                  <th style={{width: 1}}></th>
                </tr>
              </thead>
              <tbody>
                {outlets.length === 0 && (
                  <tr><td className="py-3 text-gray-500" colSpan={4}>No outlets yet.</td></tr>
                )}
                {outlets.map(o => (
                  <tr key={o.id} className="border-b">
                    <td className="py-2">
                      <input className="input-mobile border rounded-xl p-2 w-56"
                        value={o.name}
                        onChange={e => updateOutlet(o.id, { name: e.target.value })}
                        placeholder="Outlet name"/>
                    </td>
                    <td>
                      <input className="input-mobile border rounded-xl p-2 w-40"
                        value={o.code}
                        onChange={e => updateOutlet(o.id, { code: e.target.value })}
                        placeholder="Secret code"/>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={o.active}
                          onChange={e => updateOutlet(o.id, { active: e.target.checked })}/>
                        Active
                      </label>
                    </td>
                    <td>
                      <button className="btn-mobile text-xs border rounded-lg px-2 py-1" onClick={() => removeOutlet(o.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              These codes are used by the Attendant Login page to auto-map the outlet (legacy). New person codes live below.
            </p>
          </div>

          {/* People & Codes */}
          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center justify-between mb-2 mobile-scroll-x">
              <h3 className="font-semibold">People & Codes</h3>
              <div className="flex gap-2">
                <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={addCode}>+ Add code</button>
                <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={saveCodesNow}>Save Codes</button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Name</th>
                    <th>Login Code</th>
                    <th>Phone (WhatsApp)</th>
                    <th>Role</th>
                    <th>Salary (Ksh)</th>
                    <th>Freq</th>
                    <th>Status</th>
                    <th style={{width:1}}></th>
                  </tr>
                </thead>
                <tbody>
                  {codes.length === 0 && (
                    <tr><td className="py-3 text-gray-500" colSpan={6}>No codes yet.</td></tr>
                  )}
                  {codes.map(c => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2">
                        <input className="input-mobile border rounded-xl p-2 w-44"
                          value={c.name} onChange={e=>updateCode(c.id,{name:e.target.value})}
                          placeholder="Person name"/>
                      </td>
                      <td>
                        <input className="input-mobile border rounded-xl p-2 w-44 font-mono"
                          value={c.code} onChange={e=>updateCode(c.id,{code:e.target.value})}
                          placeholder="Unique code"/>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            className="input-mobile border rounded-xl p-2 w-52 font-mono"
                            placeholder="+2547…"
                            value={phones[normCode(c.code)] || ""}
                            onChange={(e)=>setPhones(prev=>({ ...prev, [normCode(c.code)]: e.target.value }))}
                          />
                          <button
                            className="btn-mobile text-xs border rounded-lg px-2 py-1"
                            title="Save this phone mapping"
                            onClick={async ()=>{
                              try {
                                const outletName = scope[normCode(c.code)]?.outlet;
                                await savePhoneFor(c.code, c.role, outletName);
                                alert("Saved ✅");
                              } catch { alert("Failed to save"); }
                            }}
                          >Save</button>
                        </div>
                      </td>
                      <td>
                        <select className="input-mobile border rounded-xl p-2"
                          value={c.role} onChange={e=>updateCode(c.id,{role:e.target.value as PersonCode["role"]})}>
                          <option value="attendant">attendant</option>
                          <option value="supervisor">supervisor</option>
                          <option value="supplier">supplier</option>
                        </select>
                      </td>
                      {/* Salary (attendants only) */}
                      <td>
                        {c.role === "attendant" ? (
                          <input
                            className="input-mobile border rounded-xl p-2 w-32"
                            type="number"
                            min={0}
                            step={1}
                            value={typeof c.salaryAmount === 'number' ? c.salaryAmount : '' as any}
                            placeholder="—"
                            onChange={(e)=>{
                              const val = e.target.value === '' ? undefined : Number(e.target.value);
                              updateCode(c.id, { salaryAmount: typeof val === 'number' && !Number.isNaN(val) ? val : undefined });
                            }}
                          />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        {c.role === "attendant" ? (
                          <select
                            className="input-mobile border rounded-xl p-2"
                            value={c.salaryFrequency || ''}
                            onChange={(e)=>updateCode(c.id, { salaryFrequency: e.target.value as any })}
                          >
                            <option value="">—</option>
                            <option value="daily">daily</option>
                            <option value="weekly">weekly</option>
                            <option value="monthly">monthly</option>
                          </select>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={c.active}
                            onChange={e=>updateCode(c.id,{active:e.target.checked})}/>
                          Active
                        </label>
                      </td>
                      <td>
                        <button className="btn-mobile text-xs border rounded-lg px-2 py-1" onClick={()=>removeCode(c.id)}>✕</button>
                        {/* Login as (impersonate) */}
                        <button
                          className="btn-mobile text-xs border rounded-lg px-2 py-1 ml-2"
                          title="Login as this person"
                          onClick={async ()=>{
                            const role = c.role;
                            const codeVal = (c.code || '').trim();
                            if (!codeVal) { alert('No code'); return; }
                            const outletName = role === 'attendant' ? (scope[canonFull(codeVal)]?.outlet || '') : '';
                            try {
                              const r = await fetch(`/api/admin/impersonate`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
                                body: JSON.stringify({ role, code: codeVal, outlet: outletName || undefined })
                              });
                              const j = await r.json().catch(()=>({ ok:false }));
                              if (!j?.ok) throw new Error(j?.error || 'Failed');
                              const to = j?.redirect || '/';
                              try {
                                const rj: any = j || {};
                                if (rj.role === 'supervisor') {
                                  sessionStorage.setItem('supervisor_code', rj.code || 'supervisor');
                                  sessionStorage.setItem('supervisor_name', rj.code || 'Supervisor');
                                } else if (rj.role === 'supplier') {
                                  sessionStorage.setItem('supplier_code', rj.code || 'supplier');
                                  sessionStorage.setItem('supplier_name', rj.code || 'Supplier');
                                }
                              } catch {}
                              // slight delay to ensure cookies are applied
                              setTimeout(()=>{ window.location.href = to; }, 200);
                            } catch (e: any) {
                              alert(e?.message || 'Failed to impersonate');
                            }
                          }}
                        >Login as</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2">
                <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={saveAllPhones}>Save Phones</button>
              </div>
            </div>
          </div>

          {/* Assignments (Attendants) */}
          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Assignments (Attendants)</h3>
              <button className="border rounded-xl px-3 py-1.5 text-sm" onClick={saveScopesNow}>Save Assignments</button>
            </div>
            <p className="text-xs text-gray-600 mt-1 mb-2">
              Choose outlet and allowed products for each attendant code. Supervisors & suppliers aren’t tied to outlets.
            </p>

            {attendantCodes.length === 0 && (
              <p className="text-xs text-gray-600">Add at least one code with role “attendant”.</p>
            )}

            {attendantCodes.map(ac => {
              const displayCode = (ac.code || "").trim();
              const key = normCode(displayCode);
              const entry = scope[key] || { outlet: "", productKeys: [] as string[] };
              const sel = new Set(entry.productKeys);
              const quickAddOptions = activeProducts.filter(p => !sel.has(p.key));

              return (
                <div key={`assign-${ac.id}`} className="rounded-xl border p-3 mb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{ac.name || "Unnamed"}</span>{" "}
                      <span className="text-gray-500">({displayCode || "no code"})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-600">Outlet</label>
                      <select
                        className="border rounded-xl p-2 text-sm"
                        value={entry.outlet}
                        onChange={e => setScopeOutlet(displayCode, e.target.value)}
                      >
                        <option value="">— select —</option>
                        {activeOutlets.map(o => (
                          <option key={o.id} value={o.name}>{o.name}</option>
                        ))}
                      </select>
                      <button className="border rounded-xl px-3 py-1 text-xs" onClick={saveScopesNow}>
                        Apply/Save
                      </button>
                      {scope[key] && (
                        <button className="border rounded-xl px-3 py-1 text-xs" onClick={() => clearScopeForCode(displayCode)}>
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Product chips */}
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
                    {activeProducts.map(p => {
                      const checked = sel.has(p.key);
                      const taken = !!entry.outlet && isProductTakenInOutlet(entry.outlet, p.key, displayCode);
                      return (
                        <label
                          key={`tick-${p.id}`}
                          className={`inline-flex items-center gap-2 text-xs border rounded-xl px-3 py-2 cursor-pointer ${checked ? "bg-black text-white" : ""} ${taken && !checked ? "opacity-40 cursor-not-allowed" : ""}`}
                          title={p.name}
                          onClick={async (e) => {
                            e.preventDefault();
                            if (checked) { toggleScopeProduct(displayCode, p.key); return; }
                            if (!taken) { toggleScopeProduct(displayCode, p.key); return; }
                            // Taken by another attendant in this outlet — offer reassignment
                            const confirmMsg = `Reassign ${p.name} to ${ac.name || displayCode} for outlet ${entry.outlet}? This will remove it from the current attendant.`;
                            const ok = window.confirm(confirmMsg);
                            if (!ok) return;
                            try {
                              const res = await fetch('/api/admin/scope/reassign', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                cache: 'no-store',
                                body: JSON.stringify({ outlet: entry.outlet, productKey: p.key, toCode: displayCode })
                              });
                              const text = await res.text();
                              let json: any = null; try { json = JSON.parse(text); } catch {}
                              if (!res.ok || !json?.ok) throw new Error(json?.error || text || 'Failed to reassign');
                              // Locally reflect the change
                              toggleScopeProduct(displayCode, p.key);
                              try { await refreshScopeFromServer(); } catch {}
                              alert('Reassigned successfully ✅');
                            } catch (err: any) {
                              alert(err?.message || 'Failed to reassign');
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            className="pointer-events-none"
                            readOnly
                            checked={checked}
                            disabled={taken && !checked}
                          />
                          <span>{p.name}</span>
                        </label>
                      );
                    })}
                  </div>

                  {/* Quick add dropdown */}
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-gray-600">Quick add:</span>
                    <select
                      className="border rounded-xl p-2 text-sm"
                      defaultValue=""
                      onChange={(e) => {
                        const k = e.target.value;
                        if (k) toggleScopeProduct(displayCode, k);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="" disabled>Select product…</option>
                      {quickAddOptions.map(p => {
                        const taken = !!entry.outlet && isProductTakenInOutlet(entry.outlet, p.key, displayCode);
                        return (
                          <option key={`qa-${p.id}`} value={p.key} disabled={taken}>{p.name}{taken ? " — taken" : ""}</option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- PRICING (combined) ---------- */}
      {tab === "pricing" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-4 mobile-scroll-x">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Pricing</h2>
              <span className="text-xs text-gray-400">Manage global products and per-outlet overrides</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`btn-mobile border rounded-xl px-3 py-1.5 text-sm ${pricingView === 'global' ? 'bg-black text-white' : ''}`}
                onClick={()=>{ setPricingView('global'); try { const url = new URL(window.location.href); url.searchParams.set('tab','pricing'); url.searchParams.set('pricing','global'); history.replaceState(null,'',url.toString()); } catch {} }}
                title="Global products & default prices"
              >Global</button>
              <button
                className={`btn-mobile border rounded-xl px-3 py-1.5 text-sm ${pricingView === 'outlet' ? 'bg-black text-white' : ''}`}
                onClick={()=>{ setPricingView('outlet'); try { const url = new URL(window.location.href); url.searchParams.set('tab','pricing'); url.searchParams.set('pricing','outlet'); history.replaceState(null,'',url.toString()); } catch {} }}
                title="Per-outlet pricebook overrides"
              >Outlet</button>
            </div>
          </div>

          {pricingView === 'global' && (
            <div>
              <div className="flex items-center justify-between mb-3 mobile-scroll-x">
                <h3 className="font-medium">Products & Prices</h3>
                <div className="flex gap-2">
                  <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addProduct}>+ Add product</button>
                  <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveProductsNow}>Submit / Save</button>
                  <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={() => setProducts(seedDefaultProducts())}>Reset defaults</button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Key</th>
                      <th>Name</th>
                      <th>Unit</th>
                      <th>Sell Price (Ksh)</th>
                      <th>Status</th>
                      <th style={{width: 1}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 && (
                      <tr><td className="py-3 text-gray-500" colSpan={6}>No products yet.</td></tr>
                    )}
                    {products.map(p => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2">
                          <input className="input-mobile border rounded-xl p-2 w-44" value={p.key} onChange={e => updateProduct(p.id, { key: e.target.value })} placeholder="unique key (e.g., beef)"/>
                        </td>
                        <td>
                          <input className="input-mobile border rounded-xl p-2 w-56" value={p.name} onChange={e => updateProduct(p.id, { name: e.target.value })} placeholder="Display name"/>
                        </td>
                        <td>
                          <select className="input-mobile border rounded-xl p-2" value={p.unit} onChange={e => updateProduct(p.id, { unit: e.target.value as Unit })}>
                            <option value="kg">kg</option>
                            <option value="pcs">pcs</option>
                          </select>
                        </td>
                        <td>
                          <input className="input-mobile border rounded-xl p-2 w-36" type="number" min={0} step={1} value={p.sellPrice} onChange={e => updateProduct(p.id, { sellPrice: n(e.target.value) })} placeholder="Ksh"/>
                        </td>
                        <td>
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={p.active} onChange={e => updateProduct(p.id, { active: e.target.checked })}/>
                            Active
                          </label>
                        </td>
                        <td>
                          <button className="btn-mobile text-xs border rounded-lg px-2 py-1" onClick={() => removeProduct(p.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-600 mt-2">These prices are global defaults; per-outlet overrides live in the Outlet view.</p>
              </div>
            </div>
          )}

          {pricingView === 'outlet' && (
            <div>
              <div className="flex items-center justify-between mb-3 mobile-scroll-x">
                <h3 className="font-medium">Outlet Pricebook</h3>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Outlet</label>
                  <select className="input-mobile border rounded-xl p-2 text-sm" value={pbOutlet} onChange={(e)=>setPbOutlet(e.target.value)}>
                    <option value="">— select outlet —</option>
                    {outlets.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                  <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={savePricebook}>Save</button>
                </div>
              </div>
              {!pbOutlet ? (
                <p className="text-sm text-gray-600">Choose an outlet to edit its prices & availability.</p>
              ) : (
                <>
                  <div className="flex gap-2 mb-3 mobile-scroll-x">
                    <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={()=>copyGlobalToOutlet(pbOutlet)}>Copy from Global</button>
                    <button className="btn-mobile border rounded-xl px-3 py-1.5 text-sm" onClick={()=>resetOutletPricebook(pbOutlet)}>Reset this Outlet</button>
                  </div>
                  <div className="table-wrap">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2">Product</th>
                          <th>Sell Price (Ksh)</th>
                          <th>Enabled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.length === 0 && (
                          <tr><td className="py-3 text-gray-500" colSpan={3}>No products defined.</td></tr>
                        )}
                        {products.map(p => {
                          const row = getPBRow(pbOutlet, p.key);
                          return (
                            <tr key={`pb-${p.id}`} className="border-b">
                              <td className="py-2">{p.name} <span className="text-xs text-gray-500">({p.key})</span></td>
                              <td>
                                <input className="input-mobile border rounded-xl p-2 w-36" type="number" min={0} step={1} value={row.sellPrice} onChange={e=>setPBRow(pbOutlet, p.key, { sellPrice: n(e.target.value) })} />
                              </td>
                              <td>
                                <input type="checkbox" checked={row.active} onChange={e=>setPBRow(pbOutlet, p.key, { active: e.target.checked })} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- OPS (Supply View + Reports + Supply History) ---------- */}
      {tab === "ops" && (
        <section className="rounded-2xl border p-4">
          <OpsCombined
            outlets={outlets}
            supply={{ supDate, setSupDate, supOutletName, setSupOutletName, ALL, supplyItems, supTotals }}
            reports={{ repDate, setRepDate, repMode, setRepMode, repRows, repTotals, salesByItem, expensesMonitor, profitEstimate, raiseExpenseDispute }}
            initialOpsTab={opsTabFromURL}
          />
        </section>
      )}

      {/* ---------- EXPENSES ---------- */}
      {tab === "expenses" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Fixed Expenses</h2>
            <div className="flex gap-2">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addExpense}>+ Add expense</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveExpensesNow}>Submit / Save</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={() => setExpenses(seedDefaultExpenses())}>
                Reset defaults
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Amount (Ksh)</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th style={{width: 1}}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && (
                  <tr><td className="py-3 text-gray-500" colSpan={5}>No expenses yet.</td></tr>
                )}
                {expenses.map(e => (
                  <tr key={e.id} className="border-b">
                    <td className="py-2">
       <input className="input-mobile border rounded-xl p-2 w-56"
                             value={e.name}
                             onChange={ev => updateExpense(e.id, { name: ev.target.value })}
                             placeholder="Expense name"/>
                    </td>
                    <td>
       <input className="input-mobile border rounded-xl p-2 w-36" type="number" min={0} step={1}
                             value={e.amount}
                             onChange={ev => updateExpense(e.id, { amount: n(ev.target.value) })}
                             placeholder="Ksh"/>
                    </td>
                    <td>
          <select className="input-mobile border rounded-xl p-2"
                              value={e.frequency}
                              onChange={ev => updateExpense(e.id, { frequency: ev.target.value as FixedExpense["frequency"] })}>
                        <option value="daily">daily</option>
                        <option value="weekly">weekly</option>
                        <option value="monthly">monthly</option>
                      </select>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={e.active}
                               onChange={ev => updateExpense(e.id, { active: ev.target.checked })}/>
                        Active
                      </label>
                    </td>
                    <td>
                        <button className="btn-mobile text-xs border rounded-lg px-2 py-1" onClick={() => removeExpense(e.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              We can later show these in Supervisor/Admin analytics (daily proration of monthly items).
            </p>
          </div>
        </section>
      )}

      {/* ---------- PERFORMANCE (embedded) ---------- */}
      {tab === "performance" && (
        <section className="rounded-2xl border p-4">
          {/* Lazy import to avoid SSR issues in client-only component */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <EmbeddedPerformance />
        </section>
      )}

      {/* ---------- DATA ---------- */}
      {tab === "data" && (
        <section className="rounded-2xl border p-4">
          {/* Admin WhatsApp */}
          <div className="rounded-xl border p-3 mt-4">
            <h3 className="font-medium mb-2">Admin WhatsApp</h3>
            <div className="flex items-center gap-2">
              <input
                className="input-mobile border rounded-xl p-2 w-64 font-mono"
                placeholder="+2547…"
                value={adminPhone}
                onChange={(e)=>setAdminPhone(e.target.value)}
              />
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveAdminPhone}>Save</button>
            </div>
            <p className="text-xs text-gray-600 mt-2">Stores a PhoneMapping with role="admin" and code="ADMIN".</p>
          </div>

          {/* Quick Admin Tools */}
          <div className="rounded-xl border p-3 mt-4">
            <h3 className="font-medium mb-2">Quick Admin Tools</h3>
            <QuickAdminTools />
          </div>

          {/* Low Stock Thresholds */}
          <div className="rounded-xl border p-3 mt-4">
            <h3 className="font-medium mb-2">Low Stock Thresholds</h3>
            <p className="text-xs text-gray-600 mb-3">Below these minimums, a WhatsApp alert is sent after attendant submission. Leave blank to ignore an item. Use Reset to fall back to system defaults.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {products.filter(p=>p.active).map(p => (
                <label key={`thr-${p.id}`} className="text-sm">
                  <div className="text-gray-600 mb-1 flex items-center justify-between gap-2">
                    <span>{p.name} <span className="text-xs text-gray-400">({p.key})</span></span>
                    <span className="text-[11px] text-gray-400">{p.unit}</span>
                  </div>
                  <input
                    className="input-mobile border rounded-xl p-2 w-full max-w-28"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="—"
                    value={Number.isFinite(thresholds[p.key]) ? String(thresholds[p.key]) : ""}
                    onChange={(e)=>{
                      const raw = e.target.value;
                      setThresholds(prev => {
                        const next = { ...prev } as Record<string, number>;
                        if (raw === "") { delete next[p.key]; return next; }
                        const num = Number(raw);
                        if (!Number.isNaN(num)) next[p.key] = num;
                        return next;
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2 mobile-scroll-x">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveThresholds} disabled={loadingThresholds}>Save Thresholds</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={resetThresholdsToSystemDefaults}>Reset to System Defaults</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={refreshThresholds} disabled={loadingThresholds}>{loadingThresholds ? "Refreshing…" : "Refresh"}</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

/** =============== UI bits =============== */
function TabBtn(props: React.PropsWithChildren<{active: boolean; onClick(): void;}>) {
  return (
    <button
      onClick={props.onClick}
      className={`px-3 py-2 rounded-2xl text-sm border ${props.active ? "bg-black text-white" : ""}`}
    >
      {props.children}
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

/** =============== Helpers =============== */
function rid() { return Math.random().toString(36).slice(2); }
function n(v: string) { return v === "" ? 0 : Number(v); }
function fmt(v: number) { return (v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function getWeekDates(dateStr: string): string[] {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diffToMonday);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const di = new Date(monday);
    di.setDate(monday.getDate() + i);
    out.push(di.toISOString().slice(0, 10));
  }
  return out;
}
function parseLS<T>(key: string): T | null {
  return safeReadJSON<T | null>(key, null);
}
function saveLS<T>(key: string, value: T) {
  try { safeWriteJSON(key, value); } catch {}
}
/** Backup/Restore helpers (unchanged) */
function exportJSON() {
  try {
    const dump = {
      [K_OUTLETS]:   safeReadJSON(K_OUTLETS,   [] as any),
      [K_PRODUCTS]:  safeReadJSON(K_PRODUCTS,  [] as any),
      [K_EXPENSES]:  safeReadJSON(K_EXPENSES,  [] as any),
      [K_CODES]:     safeReadJSON(K_CODES,     [] as any),
      [K_SCOPE]:     safeReadJSON(K_SCOPE,     {} as any),
      [K_PRICEBOOK]: safeReadJSON(K_PRICEBOOK, {} as any),
    } as const;
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dump, null, 2));
    a.download = `butchery-admin-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  } catch {}
}
function resetDefaults() {
  saveLS(K_OUTLETS,   seedDefaultOutlets());
  saveLS(K_PRODUCTS,  seedDefaultProducts());
  saveLS(K_EXPENSES,  seedDefaultExpenses());
  alert("Defaults restored. Reload to see them.");
}
function clearAll() {
  [K_OUTLETS, K_PRODUCTS, K_EXPENSES, K_CODES, K_SCOPE, K_PRICEBOOK].forEach(k => lsRemoveItem(k));
  alert("All admin data cleared from this browser.");
}
function readJSON<T>(key: string, fallback: T): T { return safeReadJSON<T>(key, fallback); }

// Lazy client-only import for the embedded Performance tab
const EmbeddedPerformance = dynamic(() => import("@/components/performance/PerformanceView"), { ssr: false });

function QuickAdminTools() {
  const [outlet, setOutlet] = React.useState<string>("");
  const [date, setDate] = React.useState<string>(new Date().toISOString().slice(0,10));
  const [statusKey, setStatusKey] = React.useState<string>("");
  const [phone, setPhone] = React.useState<string>("");
  const [code, setCode] = React.useState<string>("");
  const [impRole, setImpRole] = React.useState<"attendant"|"supervisor"|"supplier">("attendant");
  const [busy, setBusy] = React.useState<boolean>(false);
  const [msg, setMsg] = React.useState<string>("");
  const [outletOptions, setOutletOptions] = React.useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [peopleOptions, setPeopleOptions] = React.useState<Array<{ code: string; name?: string; role: string; active: boolean }>>([]);
  const [loadingLists, setLoadingLists] = React.useState<boolean>(false);
  const [wipeModal, setWipeModal] = React.useState<null | { type: 'outlet' | 'attendant'; target: string }>(null);
  const [wipeAck, setWipeAck] = React.useState<string>("");
  const [histTab, setHistTab] = React.useState<'none'|'history'>('none');
  const [inactive, setInactive] = React.useState<{ outlets: any[]; products: any[]; people: any[] }|null>(null);
  const [wipes, setWipes] = React.useState<any[]|null>(null);
  const [edits, setEdits] = React.useState<any[]|null>(null);
  const [histBanner, setHistBanner] = React.useState<string>("");

  // Load dropdown lists for outlets and person codes
  React.useEffect(() => {
    let cancelled = false;
    async function loadLists() {
      try {
        setLoadingLists(true);
        const [ro, rp] = await Promise.all([
          fetch('/api/admin/list/outlets', { cache: 'no-store' }),
          fetch('/api/admin/list/people', { cache: 'no-store' })
        ]);
        const jo = await ro.json().catch(()=>({ ok:false }));
        const jp = await rp.json().catch(()=>({ ok:false }));
        if (!cancelled) {
          if (jo?.ok && Array.isArray(jo.rows)) setOutletOptions(jo.rows.map((r: any)=>({ id: r.id, name: r.name, active: !!r.active })));
          if (jp?.ok && Array.isArray(jp.rows)) setPeopleOptions(jp.rows.map((r: any)=>({ code: r.code, name: r.name, role: r.role, active: !!r.active })));
        }
      } catch {} finally { if (!cancelled) setLoadingLists(false); }
    }
    loadLists();
    return () => { cancelled = true; };
  }, []);

  const loadHistory = async () => {
    try {
      const [ri, rw, re] = await Promise.all([
        fetch('/api/admin/history/inactive', { cache: 'no-store' }),
        fetch('/api/admin/history/wipes?limit=100', { cache: 'no-store' }),
        fetch('/api/admin/history/edits?limit=200', { cache: 'no-store' }),
      ]);
      const ji = await ri.json().catch(()=>({ ok:false }));
      const jw = await rw.json().catch(()=>({ ok:false }));
      const je = await re.json().catch(()=>({ ok:false }));
      if (ji?.ok) setInactive({ outlets: ji.outlets || [], products: ji.products || [], people: ji.people || [] });
      if (jw?.ok) setWipes(jw.events || []);
      if (je?.ok) setEdits(je.events || []);
      setHistTab('history');
    } catch {}
  };

  // Refresh only Admin Edits list after a restore, without reloading everything
  const refreshEdits = async () => {
    try {
      const re = await fetch('/api/admin/history/edits?limit=200', { cache: 'no-store' });
      const je = await re.json().catch(()=>({ ok:false }));
      if (je?.ok) setEdits(je.events || []);
    } catch {}
  };

  const clearDayData = async () => {
    if (!outlet || !date) { setMsg("Pick outlet and date"); return; }
    if (!confirm(`Clear data for ${outlet} — ${date}? This deletes opening, closings, expenses, deposits, till and resets locks.`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/data/clear` , {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ outlet, date })
      });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setMsg(`Cleared: ${JSON.stringify(j.deleted)}`);
    } catch (e: any) { setMsg(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const startNewPeriod = async () => {
    if (!outlet) { setMsg("Pick outlet"); return; }
    if (!confirm(`Start a new trading period now for ${outlet}?`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/period/start-force` , {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ outlet })
      });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setMsg(`New period started for ${j.outlet} (${j.date})`);
    } catch (e: any) { setMsg(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const clearWaSessions = async () => {
    if (!phone && !code) { setMsg("Enter phone or code to clear sessions"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/wa-session/clear` , {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ phone: phone || undefined, code: code || undefined })
      });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setMsg(`WA sessions deleted: ${j.deleted}`);
    } catch (e: any) { setMsg(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const impersonate = async () => {
    const impersonateCode = (code || "").trim();
    if (!impersonateCode) { setMsg("Enter code to impersonate"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/impersonate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ role: impRole, code: impersonateCode, outlet: outlet || undefined })
      });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      const to = j?.redirect || '/';
      setMsg(`Impersonation ok → ${to}`);
      try {
        const rj: any = j || {};
        if (rj.role === 'supervisor') {
          sessionStorage.setItem('supervisor_code', rj.code || 'supervisor');
          sessionStorage.setItem('supervisor_name', rj.code || 'Supervisor');
        } else if (rj.role === 'supplier') {
          sessionStorage.setItem('supplier_code', rj.code || 'supplier');
          sessionStorage.setItem('supplier_name', rj.code || 'Supplier');
        }
      } catch {}
      // small delay to ensure cookie is applied on client before navigate
      setTimeout(()=>{ window.location.href = to; }, 300);
    } catch (e: any) { setMsg(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const wipeInactiveAttendant = () => {
    const c = (code || '').trim();
    if (!c) { setMsg('Pick code'); return; }
    setWipeAck("");
    setWipeModal({ type: 'attendant', target: c });
  };

  const wipeInactiveOutlet = () => {
    const on = (outlet || '').trim();
    if (!on) { setMsg('Pick outlet'); return; }
    setWipeAck("");
    setWipeModal({ type: 'outlet', target: on });
  };

  const performWipe = async () => {
    if (!wipeModal) return;
    const target = wipeModal.target;
    setBusy(true); setMsg("");
    try {
      if (wipeModal.type === 'attendant') {
        const r = await fetch('/api/admin/wipe/attendant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ code: target, onlyIfInactive: true }) });
        const j = await r.json().catch(()=>({ ok:false }));
        if (!j?.ok) throw new Error(j?.error || 'Failed');
        setMsg(`Wiped attendant ${j.code}. Deleted: ${JSON.stringify(j.deleted)}`);
      } else {
        const r = await fetch('/api/admin/wipe/outlet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ outletName: target, onlyIfInactive: true }) });
        const j = await r.json().catch(()=>({ ok:false }));
        if (!j?.ok) throw new Error(j?.error || 'Failed');
        setMsg(`Wiped outlet ${j.outletName}. Deleted: ${JSON.stringify(j.deleted)}`);
      }
      setWipeModal(null);
    } catch (e:any) { setMsg(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-sm">
          <div className="text-gray-600 mb-1">Outlet</div>
          {outletOptions.length > 0 ? (
            <select className="input-mobile border rounded-xl p-2 w-full" value={outlet} onChange={e=>setOutlet(e.target.value)}>
              <option value="">Pick outlet…</option>
              {outletOptions.map(o => (
                <option key={o.id} value={o.name}>{o.name}{o.active ? '' : ' (inactive)'}</option>
              ))}
            </select>
          ) : (
            <input className="input-mobile border rounded-xl p-2 w-full" placeholder="e.g., Bright" value={outlet} onChange={e=>setOutlet(e.target.value)} />
          )}
        </label>
        <label className="text-sm">
          <div className="text-gray-600 mb-1">Date</div>
          <input className="input-mobile border rounded-xl p-2 w-full" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </label>
        {/* STATUS_PUBLIC_KEY no longer required for impersonation */}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-mobile border rounded-xl px-3 py-2 text-sm disabled:opacity-50" onClick={clearDayData} disabled={busy}>Clear Day (outlet+date)</button>
        <button className="btn-mobile border rounded-xl px-3 py-2 text-sm disabled:opacity-50" onClick={startNewPeriod} disabled={busy}>Start New Period Now</button>
        <button className="btn-mobile border rounded-xl px-3 py-2 text-sm disabled:opacity-50" onClick={wipeInactiveOutlet} disabled={busy}>Wipe Inactive Outlet</button>
        <button className="btn-mobile border rounded-xl px-3 py-2 text-sm disabled:opacity-50" onClick={loadHistory} disabled={busy}>View History</button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">
          <div className="text-gray-600 mb-1">WA Phone (E.164)</div>
          <input className="input-mobile border rounded-xl p-2 w-full font-mono" placeholder="+2547…" value={phone} onChange={e=>setPhone(e.target.value)} />
        </label>
        <label className="text-sm">
          <div className="text-gray-600 mb-1">Person Code</div>
          {peopleOptions.length > 0 ? (
            <select className="input-mobile border rounded-xl p-2 w-full" value={code} onChange={e=>setCode(e.target.value)}>
              <option value="">Pick person…</option>
              {peopleOptions.map(p => (
                <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''} [{p.role}] {p.active ? '' : '(inactive)'}</option>
              ))}
            </select>
          ) : (
            <input className="input-mobile border rounded-xl p-2 w-full" placeholder="code" value={code} onChange={e=>setCode(e.target.value)} />
          )}
        </label>
        <div className="flex items-end">
          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm w-full disabled:opacity-50" onClick={clearWaSessions} disabled={busy}>Clear WA Sessions</button>
        </div>
      </div>

      {/* Impersonation */}
      <div className="rounded-xl border p-3 mt-3">
        <h4 className="font-medium mb-2">Impersonate (Login as)</h4>
        <div className="grid sm:grid-cols-4 gap-3">
          <label className="text-sm">
            <div className="text-gray-600 mb-1">Role</div>
            <select className="input-mobile border rounded-xl p-2 w-full" value={impRole} onChange={e=>setImpRole(e.target.value as any)}>
              <option value="attendant">attendant</option>
              <option value="supervisor">supervisor</option>
              <option value="supplier">supplier</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="text-gray-600 mb-1">Code</div>
            {peopleOptions.length > 0 ? (
              <select className="input-mobile border rounded-xl p-2 w-full" value={code} onChange={e=>setCode(e.target.value)}>
                <option value="">Pick person…</option>
                {peopleOptions.map(p => (
                  <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ''} [{p.role}] {p.active ? '' : '(inactive)'}</option>
                ))}
              </select>
            ) : (
              <input className="input-mobile border rounded-xl p-2 w-full" placeholder="e.g., JACKSONA1" value={code} onChange={e=>setCode(e.target.value)} />
            )}
          </label>
          <label className="text-sm">
            <div className="text-gray-600 mb-1">Outlet (optional)</div>
            {outletOptions.length > 0 ? (
              <select className="input-mobile border rounded-xl p-2 w-full" value={outlet} onChange={e=>setOutlet(e.target.value)}>
                <option value="">—</option>
                {outletOptions.map(o => (
                  <option key={o.id} value={o.name}>{o.name}{o.active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            ) : (
              <input className="input-mobile border rounded-xl p-2 w-full" placeholder="e.g., Bright" value={outlet} onChange={e=>setOutlet(e.target.value)} />
            )}
          </label>
          <div className="flex items-end">
            <button className="btn-mobile border rounded-xl px-3 py-2 text-sm w-full disabled:opacity-50" onClick={impersonate} disabled={busy}>Login as</button>
          </div>
        </div>
  <p className="text-xs text-gray-600 mt-2">Attendant creates a DB session cookie; others set a role cookie only.</p>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm disabled:opacity-50" onClick={wipeInactiveAttendant} disabled={busy}>Wipe Inactive Attendant</button>
        </div>
      </div>
      {msg && <div className="text-sm text-gray-700">{msg}</div>}

      {/* Wipe confirmation modal */}
      {wipeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-[92vw] max-w-xl p-4">
            <h4 className="font-semibold mb-2">
              {wipeModal.type === 'attendant' ? 'Confirm Wipe: Attendant' : 'Confirm Wipe: Outlet'}
            </h4>
            <p className="text-sm text-gray-700 mb-3">
              You are about to permanently delete data for
              <span className="font-mono font-semibold"> {wipeModal.target}</span>.
              This action cannot be undone.
            </p>
            {wipeModal.type === 'attendant' ? (
              <div className="text-sm text-gray-700 mb-3">
                <div className="font-medium mb-1">This will remove:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>WhatsApp sessions for this code</li>
                  <li>Phone mapping for this code</li>
                  <li>Assignments and product scope</li>
                  <li>Login codes</li>
                  <li>Deposits recorded by code</li>
                  <li>Attendant sessions, shifts, KPIs</li>
                  <li>Attendant record (and unlink message logs)</li>
                  <li>PersonCode will be deactivated</li>
                </ul>
                <p className="text-xs text-gray-500 mt-2">Note: Wipe proceeds only if the person code is inactive.</p>
              </div>
            ) : (
              <div className="text-sm text-gray-700 mb-3">
                <div className="font-medium mb-1">This will remove per‑outlet data:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>ActivePeriod pointer</li>
                  <li>Supply opening rows</li>
                  <li>Attendant closings, expenses, deposits, till counts</li>
                  <li>Pricebook rows and attendant assignments</li>
                  <li>Review items</li>
                  <li>Outlet performance and product supply stats</li>
                  <li>Supply recommendations and interval performance</li>
                  <li>Day close periods and supervisor commissions</li>
                  <li>Outlet targets and waste thresholds</li>
                  <li>Settings keys referencing this outlet</li>
                  <li>Outlet will be deactivated and attendants unlinked</li>
                </ul>
                <p className="text-xs text-gray-500 mt-2">Note: Wipe proceeds only if the outlet is inactive.</p>
              </div>
            )}
            <div className="rounded-xl border p-3 bg-gray-50 mb-3">
              <label className="block text-xs text-gray-600 mb-1">Type the exact {wipeModal.type === 'attendant' ? 'code' : 'outlet name'} to confirm</label>
              <input
                className="input-mobile border rounded-xl p-2 w-full font-mono"
                placeholder={wipeModal.target}
                value={wipeAck}
                onChange={e=>setWipeAck(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={()=>setWipeModal(null)} disabled={busy}>Cancel</button>
              <button
                className="btn-mobile border rounded-xl px-3 py-2 text-sm bg-red-600 text-white disabled:opacity-50"
                onClick={performWipe}
                disabled={busy || wipeAck.trim() !== wipeModal.target}
              >
                Proceed & Wipe
              </button>
            </div>
          </div>
        </div>
      )}

      {histTab === 'history' && (
        <div className="rounded-2xl border p-3 mt-3">
          <h4 className="font-semibold mb-3">History</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <h5 className="font-medium mb-2">Inactive Records</h5>
              <div className="text-xs text-gray-700 space-y-2">
                <div>
                  <div className="text-gray-500">Outlets</div>
                  <ul className="list-disc pl-4">
                    {(inactive?.outlets || []).map(o => <li key={o.id}><span className="font-mono">{o.name}</span></li>)}
                    {(inactive?.outlets || []).length === 0 && <li className="text-gray-400">none</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-gray-500">Products</div>
                  <ul className="list-disc pl-4">
                    {(inactive?.products || []).map(p => <li key={p.id}><span className="font-mono">{p.key}</span> — {p.name}</li>)}
                    {(inactive?.products || []).length === 0 && <li className="text-gray-400">none</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-gray-500">People (codes)</div>
                  <ul className="list-disc pl-4">
                    {(inactive?.people || []).map(pc => <li key={pc.id}><span className="font-mono">{pc.code}</span> [{pc.role}] {pc.name || ''}</li>)}
                    {(inactive?.people || []).length === 0 && <li className="text-gray-400">none</li>}
                  </ul>
                </div>
              </div>
            </div>
            <div>
              <h5 className="font-medium mb-2">Wipe Events</h5>
              <div className="text-xs text-gray-700">
                <div className="max-h-64 overflow-auto border rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">At</th>
                        <th>Type</th>
                        <th>Target</th>
                        <th>Counts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(wipes || []).map((w, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2 whitespace-nowrap">{new Date(w.at).toLocaleString()}</td>
                          <td>{w.type}</td>
                          <td className="font-mono">{w.target}</td>
                          <td><code>{JSON.stringify(w.counts)}</code></td>
                        </tr>
                      ))}
                      {(!wipes || wipes.length === 0) && (
                        <tr><td className="py-2 text-gray-400" colSpan={4}>none</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <h5 className="font-medium mb-2">Admin Edits</h5>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600">Most recent changes (before/after, with reason)</span>
              {histBanner && (
                <span className="ml-3 text-[11px] px-2 py-1 rounded bg-green-100 text-green-800 border border-green-300">{histBanner}</span>
              )}
              <button className="btn-mobile border rounded-xl px-2 py-1 text-xs" onClick={()=>{
                const rows = (edits||[]).map((e:any)=>({ at: new Date(e.at).toISOString(), type: e.type, id: e.id, reason: (e as any)?.reason || '', before: JSON.stringify(e.before||{}), after: JSON.stringify(e.after||{}) }));
                const csv = ["at,type,id,reason,before,after"].concat(rows.map(r=>{
                  const reason = String(r.reason || "").replaceAll('"', '""');
                  const before = String(r.before || "").replaceAll('"', '""');
                  const after = String(r.after || "").replaceAll('"', '""');
                  return `${r.at},${r.type},${r.id},"${reason}","${before}","${after}"`;
                })).join("\n");
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = `admin-edits-${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
              }}>Export CSV</button>
            </div>
            <div className="text-xs text-gray-700">
              <div className="max-h-64 overflow-auto border rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">At</th>
                      <th>Type</th>
                      <th>ID</th>
                      <th>Reason</th>
                      <th>Before → After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(edits || []).map((e: any, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="py-2 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                        <td>{e.type}</td>
                        <td className="font-mono">{e.id}</td>
                        <td className="whitespace-pre-wrap">{e?.reason || ''}</td>
                        <td className="font-mono whitespace-pre-wrap text-[10px]">
                          <div>{JSON.stringify(e.before || {}, null, 2)}</div>
                          <div className="text-center">↓</div>
                          <div>{JSON.stringify(e.after || {}, null, 2)}</div>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              className="btn-mobile border rounded-lg px-2 py-1 text-[11px]"
                              title="Restore to BEFORE snapshot"
                              onClick={async ()=>{
                                const rsn = window.prompt('Reason for restore (optional):', '');
                                try {
                                  const r = await fetch('/api/admin/history/edits/restore', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: e.key, target: 'before', reason: rsn || undefined })
                                  });
                                  const j = await r.json().catch(()=>({ ok:false }));
                                  if (!j?.ok) throw new Error(j?.error || 'Failed');
                                  setHistBanner('Restored to BEFORE snapshot ✅');
                                  refreshEdits();
                                  setTimeout(()=>setHistBanner(''), 2000);
                                } catch (err:any) { alert(err?.message || 'Failed'); }
                              }}
                            >Restore (Before)</button>
                            <button
                              className="btn-mobile border rounded-lg px-2 py-1 text-[11px]"
                              title="Restore to AFTER snapshot"
                              onClick={async ()=>{
                                const rsn = window.prompt('Reason for restore (optional):', '');
                                try {
                                  const r = await fetch('/api/admin/history/edits/restore', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: e.key, target: 'after', reason: rsn || undefined })
                                  });
                                  const j = await r.json().catch(()=>({ ok:false }));
                                  if (!j?.ok) throw new Error(j?.error || 'Failed');
                                  setHistBanner('Restored to AFTER snapshot ✅');
                                  refreshEdits();
                                  setTimeout(()=>setHistBanner(''), 2000);
                                } catch (err:any) { alert(err?.message || 'Failed'); }
                              }}
                            >Restore (After)</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(!edits || edits.length === 0) && (
                      <tr><td className="py-2 text-gray-400" colSpan={5}>none</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Entries */}
      <div className="rounded-2xl border p-3 mt-3">
        <h4 className="font-semibold mb-3">Edit Entries (Admin)</h4>
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input className="input-mobile border rounded-xl p-2 w-full" type="date" value={date} onChange={e=>setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Outlet</label>
            {outletOptions.length > 0 ? (
              <select className="input-mobile border rounded-xl p-2 w-full" value={outlet} onChange={e=>setOutlet(e.target.value)}>
                <option value="">Pick outlet…</option>
                {outletOptions.map(o => (
                  <option key={o.id} value={o.name}>{o.name}{o.active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            ) : (
              <input className="input-mobile border rounded-xl p-2 w-full" placeholder="e.g., Bright" value={outlet} onChange={e=>setOutlet(e.target.value)} />
            )}
          </div>
          <div className="flex items-end">
            <button className="btn-mobile border rounded-xl px-3 py-2 text-sm w-full" onClick={async()=>{
              if (!date || !outlet) { setMsg('Pick date and outlet'); return; }
              try {
                const [rt, rc, ro] = await Promise.all([
                  fetch(`/api/admin/day/txns?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet)}`, { cache: 'no-store' }),
                  fetch(`/api/admin/day/closings?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet)}`, { cache: 'no-store' }),
                  fetch(`/api/admin/day/opening?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet)}`, { cache: 'no-store' }),
                ]);
                const jt = await rt.json().catch(()=>({ ok:false }));
                const jc = await rc.json().catch(()=>({ ok:false }));
                const jo = await ro.json().catch(()=>({ ok:false }));
                ;(window as any).__ADMIN_EDIT_CTX__ = { deposits: jt?.deposits||[], expenses: jt?.expenses||[], closings: jc?.closings||[], openings: jo?.openings||[] };
                setMsg('Loaded entries. Scroll below to edit.');
              } catch (e:any) { setMsg(e?.message || 'Failed'); }
            }}>Load</button>
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="rounded-xl border p-2">
            <h5 className="font-medium mb-2">Supply (Opening)</h5>
            <AdminEditOpeningList />
          </div>
          <div className="rounded-xl border p-2">
            <h5 className="font-medium mb-2">Deposits</h5>
            <AdminEditList kind="deposit" />
          </div>
          <div className="rounded-xl border p-2">
            <h5 className="font-medium mb-2">Expenses</h5>
            <AdminEditList kind="expense" />
          </div>
          <div className="rounded-xl border p-2">
            <h5 className="font-medium mb-2">Closings</h5>
            <AdminEditList kind="closing" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminEditList(props: { kind: 'deposit'|'expense'|'closing' }) {
  const { kind } = props;
  const [rows, setRows] = React.useState<any[]>([]);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const ctx = (window as any).__ADMIN_EDIT_CTX__ || {};
    const r = kind === 'deposit' ? (ctx.deposits||[]) : kind === 'expense' ? (ctx.expenses||[]) : (ctx.closings||[]);
    setRows(r);
  }, [tick, kind]);

  const save = async (id: string, patch: any) => {
    try {
      const url = kind === 'deposit' ? '/api/admin/edit/deposit' : kind === 'expense' ? '/api/admin/edit/expense' : '/api/admin/edit/closing';
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setTick(x=>x+1);
    } catch (e:any) { alert(e?.message || 'Failed'); }
  };

  if (!rows || rows.length === 0) return <div className="text-xs text-gray-500">No entries loaded yet.</div>;

  return (
    <div className="space-y-2 max-h-64 overflow-auto">
      {rows.map((r: any) => (
        <div key={r.id} className="rounded-lg border p-2 text-xs space-y-2">
          <div className="text-gray-500">id: <span className="font-mono">{r.id}</span></div>
          {kind === 'deposit' && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <div>Amount</div>
                <input className="input-mobile border rounded p-1 w-full" type="number" defaultValue={r.amount} onBlur={(e)=>save(r.id, { amount: Number(e.target.value) })} />
              </label>
              <label>
                <div>Note</div>
                <input className="input-mobile border rounded p-1 w-full" defaultValue={r.note||''} onBlur={(e)=>save(r.id, { note: e.target.value })} />
              </label>
              <label className="col-span-2">
                <div>Status</div>
                <select className="input-mobile border rounded p-1 w-full" defaultValue={r.status||'PENDING'} onChange={(e)=>save(r.id, { status: e.target.value })}>
                  <option value="VALID">VALID</option>
                  <option value="PENDING">PENDING</option>
                  <option value="INVALID">INVALID</option>
                </select>
              </label>
            </div>
          )}
          {kind === 'expense' && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <div>Amount</div>
                <input className="input-mobile border rounded p-1 w-full" type="number" defaultValue={r.amount} onBlur={(e)=>save(r.id, { amount: Number(e.target.value) })} />
              </label>
              <label>
                <div>Name</div>
                <input className="input-mobile border rounded p-1 w-full" defaultValue={r.name||''} onBlur={(e)=>save(r.id, { name: e.target.value })} />
              </label>
            </div>
          )}
          {kind === 'closing' && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <div>Closing Qty</div>
                <input className="input-mobile border rounded p-1 w-full" type="number" step="0.01" defaultValue={r.closingQty} onBlur={(e)=>save(r.id, { closingQty: Number(e.target.value) })} />
              </label>
              <label>
                <div>Waste Qty</div>
                <input className="input-mobile border rounded p-1 w-full" type="number" step="0.01" defaultValue={r.wasteQty} onBlur={(e)=>save(r.id, { wasteQty: Number(e.target.value) })} />
              </label>
              <label className="col-span-2">
                <div>Reason (optional)</div>
                <input className="input-mobile border rounded p-1 w-full" placeholder="Why the correction?" onBlur={(e)=>save(r.id, { reason: e.target.value })} />
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminEditOpeningList() {
  const [rows, setRows] = React.useState<any[]>([]);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const ctx = (window as any).__ADMIN_EDIT_CTX__ || {};
    setRows(ctx.openings || []);
  }, [tick]);

  const save = async (id: string, patch: any) => {
    try {
      const r = await fetch('/api/admin/edit/opening', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setTick(x=>x+1);
    } catch (e:any) { alert(e?.message || 'Failed'); }
  };

  if (!rows || rows.length === 0) return <div className="text-xs text-gray-500">No entries loaded yet.</div>;

  return (
    <div className="space-y-2 max-h-64 overflow-auto">
      {rows.map((r: any) => (
        <div key={r.id} className="rounded-lg border p-2 text-xs space-y-2">
          <div className="text-gray-500">id: <span className="font-mono">{r.id}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <label>
              <div>Qty</div>
              <input className="input-mobile border rounded p-1 w-full" type="number" step="0.01" defaultValue={r.qty} onBlur={(e)=>save(r.id, { qty: Number(e.target.value) })} />
            </label>
            <label>
              <div>Unit</div>
              <input className="input-mobile border rounded p-1 w-full" defaultValue={r.unit || ''} onBlur={(e)=>save(r.id, { unit: e.target.value })} />
            </label>
            <label>
              <div>Buy Price</div>
              <input className="input-mobile border rounded p-1 w-full" type="number" step="0.01" defaultValue={r.buyPrice} onBlur={(e)=>save(r.id, { buyPrice: Number(e.target.value) })} />
            </label>
            <label className="col-span-3">
              <div>Reason (optional)</div>
              <input className="input-mobile border rounded p-1 w-full" placeholder="Why the correction?" onBlur={(e)=>save(r.id, { reason: e.target.value })} />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Combined Ops component: groups Supply View, Reports, and Supply History under one umbrella with sub-tabs.
 */
function OpsCombined(props: {
  outlets: Outlet[];
  supply: {
    supDate: string;
    setSupDate: (v: string) => void;
    supOutletName: string;
    setSupOutletName: (v: string) => void;
    ALL: string;
    supplyItems: Array<{ itemKey: string; name: string; unit: Unit; qty: number; buyPrice: number; amount: number }>;
    supTotals: { qty: number; amount: number };
  };
  reports: {
    repDate: string;
    setRepDate: (v: string) => void;
    repMode: "day" | "week";
    setRepMode: (v: "day" | "week") => void;
    repRows: Array<{ outlet: string; expectedKsh: number; depositedKsh: number; expensesKsh: number; cashAtTill: number; varianceKsh: number; hasData: boolean }>;
    repTotals: { expectedKsh: number; depositedKsh: number; expensesKsh: number; cashAtTill: number; varianceKsh: number };
    salesByItem: Array<{ key: string; name: string; unit: Unit; soldQty: number; wasteQty: number; revenue: number }>;
    expensesMonitor: { perOutlet: Array<{ outlet: string; total: number }>; totalAll: number };
    profitEstimate: { revenue: number; supplyTotal: number; expensesTotal: number; grossProfit: number; netAfterExpenses: number };
    raiseExpenseDispute: (outletName: string) => void;
  };
  initialOpsTab?: "supply" | "reports" | "history";
}) {
  const { outlets, supply, reports, initialOpsTab } = props;
  const [opsTab, setOpsTab] = React.useState<"supply" | "reports" | "history">(initialOpsTab || "supply");

  return (
    <div>
      <div className="flex gap-2 mb-4 mobile-scroll-x">
        <TabBtn active={opsTab === "supply"} onClick={() => setOpsTab("supply")}>Supply View</TabBtn>
        <TabBtn active={opsTab === "reports"} onClick={() => setOpsTab("reports")}>Reports</TabBtn>
        <TabBtn active={opsTab === "history"} onClick={() => setOpsTab("history")}>Supply History</TabBtn>
      </div>

      {opsTab === "supply" && (
        <section>
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Supply View</h2>
            <div className="flex items-center gap-2">
              <input
                className="input-mobile border rounded-xl p-2 text-sm"
                type="date"
                value={supply.supDate}
                onChange={(e)=>supply.setSupDate(e.target.value)}
              />
              <select
                className="input-mobile border rounded-xl p-2 text-sm"
                value={supply.supOutletName}
                onChange={(e)=>supply.setSupOutletName(e.target.value)}
              >
                <option value={supply.ALL}>All outlets</option>
                {outlets.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            </div>
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Buy Price</th>
                  <th>Total (Ksh)</th>
                </tr>
              </thead>
              <tbody>
                {supply.supplyItems.length === 0 ? (
                  <tr><td className="py-3 text-gray-500" colSpan={5}>No opening recorded by Supplier for this date/outlet.</td></tr>
                ) : (
                  supply.supplyItems.map((r, i) => (
                    <tr key={`${r.itemKey}-${i}`} className="border-b">
                      <td className="py-2">{r.name}</td>
                      <td>{fmt(r.qty)}</td>
                      <td>{r.unit}</td>
                      <td>{fmt(r.buyPrice)}</td>
                      <td>{fmt(r.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {supply.supplyItems.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Totals</td>
                    <td>{fmt(supply.supTotals.qty)}</td>
                    <td></td>
                    <td></td>
                    <td>{fmt(supply.supTotals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">Read-only mirror of supplier opening for attendants.</p>
        </section>
      )}

      {opsTab === "reports" && (
        <section>
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Reports</h2>
            <div className="flex items-center gap-2">
              <input
                className="input-mobile border rounded-xl p-2 text-sm"
                type="date"
                value={reports.repDate}
                onChange={(e)=>reports.setRepDate(e.target.value)}
              />
              <select
                className="input-mobile border rounded-xl p-2 text-sm"
                value={reports.repMode}
                onChange={(e)=>reports.setRepMode(e.target.value as any)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </div>
          </div>

          {/* Summary per outlet */}
          <div className="table-wrap mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Outlet</th>
                  <th>Expected (Ksh)</th>
                  <th>Deposited (Ksh)</th>
                  <th>Expenses (Ksh)</th>
                  <th>Cash At Till (Ksh)</th>
                  <th>Variance (Ksh)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                  {reports.repRows.length === 0 ? (
                    <tr><td className="py-3 text-gray-500" colSpan={7}>No outlets.</td></tr>
                ) : (
                  reports.repRows.map(r => (
                    <tr key={r.outlet} className="border-b">
                      <td className="py-2">{r.outlet}</td>
                      <td>{fmt(r.expectedKsh)}</td>
                      <td>{fmt(r.depositedKsh)}</td>
                      <td>{fmt(r.expensesKsh)}</td>
                      <td>{fmt(r.cashAtTill)}</td>
                      <td className={r.varianceKsh === 0 ? "text-green-700" : r.varianceKsh < 0 ? "text-red-700" : "text-yellow-700"}>
                        {fmt(r.varianceKsh)}
                      </td>
                      <td>
                        {!r.hasData ? (
                          <span className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-800">no data</span>
                        ) : r.varianceKsh < 0 ? (
                          <span className="px-2 py-1 rounded text-xs bg-red-200 text-red-800">deficit</span>
                        ) : r.varianceKsh > 0 ? (
                          <span className="px-2 py-1 rounded text-xs bg-yellow-200 text-yellow-800">excess</span>
                        ) : (
                          <span className="px-2 py-1 rounded text-xs bg-green-200 text-green-800">balanced</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {reports.repRows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Totals</td>
                    <td>{fmt(reports.repTotals.expectedKsh)}</td>
                    <td>{fmt(reports.repTotals.depositedKsh)}</td>
                    <td>{fmt(reports.repTotals.expensesKsh)}</td>
                    <td>{fmt(reports.repTotals.cashAtTill)}</td>
                    <td>{fmt(reports.repTotals.varianceKsh)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Sales by item + waste */}
          <div className="rounded-xl border p-3 mb-6">
            <h3 className="font-semibold mb-2">Sales by Item (and Waste)</h3>
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Item</th>
                    <th>Sold Qty</th>
                    <th>Waste</th>
                    <th>Unit</th>
                    <th>Revenue (Ksh)</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.salesByItem.length === 0 ? (
                    <tr><td className="py-3 text-gray-500" colSpan={5}>No data for range.</td></tr>
                  ) : reports.salesByItem.map(r => (
                    <tr key={r.key} className="border-b">
                      <td className="py-2">{r.name}</td>
                      <td>{fmt(r.soldQty)}</td>
                      <td>{fmt(r.wasteQty)}</td>
                      <td>{r.unit}</td>
                      <td>{fmt(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                {reports.salesByItem.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="py-2">Totals</td>
                      <td>{fmt(reports.salesByItem.reduce((a,r)=>a+r.soldQty,0))}</td>
                      <td>{fmt(reports.salesByItem.reduce((a,r)=>a+r.wasteQty,0))}</td>
                      <td></td>
                      <td>{fmt(reports.salesByItem.reduce((a,r)=>a+r.revenue,0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Expenses monitor */}
          <div className="rounded-xl border p-3 mb-6">
            <h3 className="font-semibold mb-2">Expenses Monitor (range)</h3>
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Outlet</th>
                    <th>Total Expenses (Ksh)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.expensesMonitor.perOutlet.map(row => (
                    <tr key={row.outlet} className="border-b">
                      <td className="py-2">{row.outlet}</td>
                      <td>{fmt(row.total)}</td>
                      <td>
                        <button className="btn-mobile border rounded-lg px-2 py-1 text-xs" onClick={()=>reports.raiseExpenseDispute(row.outlet)}>
                          Dispute/Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">All outlets</td>
                    <td>{fmt(reports.expensesMonitor.totalAll)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Profit snapshot */}
          <div className="rounded-xl border p-3">
            <h3 className="font-semibold mb-2">Profit Snapshot (range)</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <KPI label="Revenue (Ksh)"        value={fmt(reports.profitEstimate.revenue)} />
              <KPI label="Supply Cost (Ksh)"    value={fmt(reports.profitEstimate.supplyTotal)} />
              <KPI label="Gross Profit (Ksh)"   value={fmt(reports.profitEstimate.grossProfit)} />
              <KPI label="Expenses (Ksh)"       value={fmt(reports.profitEstimate.expensesTotal)} />
              <KPI label="Net After Exp (Ksh)"  value={fmt(reports.profitEstimate.netAfterExpenses)} />
            </div>
          </div>
        </section>
      )}

      {opsTab === "history" && (
        <section>
          <SupplyHistoryEmbed />
        </section>
      )}
    </div>
  );
}

function SupplyHistoryEmbed() {
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

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const dateNDaysAgoISO = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

  const [from, setFrom] = React.useState(dateNDaysAgoISO(6));
  const [to, setTo] = React.useState(todayISO());
  const [outlet, setOutlet] = React.useState("");
  const [sort, setSort] = React.useState<"date_desc"|"date_asc"|"outlet_asc"|"outlet_desc"|"name_asc"|"name_desc">("date_desc");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    try {
      setLoading(true); setError(null);
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (outlet.trim()) qs.set("outlet", outlet.trim());
      if (sort) qs.set("sort", sort);
      qs.set("limit", "200");
      const r = await fetch(`/api/supply/history/all?${qs.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { ok: boolean; rows: Row[] };
      if (!data || data.ok !== true) throw new Error("Failed to load");
      setRows(data.rows || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totals = React.useMemo(() => {
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
    <div>
      <div className="flex items-center justify-between mb-3 mobile-scroll-x">
        <h2 className="font-semibold">Supply History</h2>
      </div>

      <div className="rounded-2xl border p-3 mb-4">
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
        <KPI label="Total Qty" value={fmt(totals.qty)} />
        <KPI label="Total Buy (Ksh)" value={`Ksh ${fmt(totals.buy)}`} />
        <KPI label="Total Sell (Ksh)" value={`Ksh ${fmt(totals.sell)}`} />
        <KPI label="Margin (Ksh)" value={`Ksh ${fmt(totals.margin)}`} />
      </div>

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
      <p className="text-xs text-gray-500 mt-3">
        Note: Supplier filter is not shown here because opening rows don’t store supplier attribution. For supplier-submitted orders, use supply.create views.
      </p>
    </div>
  );
}

// src/app/admin/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
  | "products"
  | "pricebook"
  | "supply"
  | "reports"
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

  // ---------- warm welcome (kept) ----------
  const [welcome, setWelcome] = useState<string>("");
  useEffect(() => {
    const msg = sessionStorage.getItem("admin_welcome");
    if (msg) setWelcome(msg);
  }, []);

  const [tab, setTab] = useState<AdminTab>("outlets");

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
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ ok: boolean; count: number }>
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
    } catch {
      alert("Saved locally, but failed to sync assignments to server.");
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
  // Outlets
  const addOutlet = () => setOutlets(v => [...v, { id: rid(), name: "", code: "", active: true }]);
  const removeOutlet = (id: string) => setOutlets(v => v.filter(x => x.id !== id));
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
  const removeCode = (id: string) => setCodes(v => v.filter(c => c.id !== id));
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

  const toggleScopeProduct = (code: string, prodKey: string) => {
    const key = normCode(code || "");
    if (!key) return;
    setScope(prev => {
      const next = { ...prev };
      const entry = next[key] ?? { outlet: "", productKeys: [] as string[] };
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
        <TabBtn active={tab==="products"}  onClick={() => setTab("products")}>Products & Prices</TabBtn>
        <TabBtn active={tab==="pricebook"} onClick={() => setTab("pricebook")}>Outlet Pricebook</TabBtn>
        <TabBtn active={tab==="supply"}    onClick={() => setTab("supply")}>Supply View</TabBtn>
        <TabBtn active={tab==="reports"}   onClick={() => setTab("reports")}>Reports</TabBtn>
    <TabBtn active={tab==="expenses"}  onClick={() => setTab("expenses")}>Fixed Expenses</TabBtn>
    {/* Performance now embedded as a tab */}
    <TabBtn active={tab==="performance"} onClick={() => setTab("performance")}>Performance</TabBtn>
    {/* Data tab contains Backup/Restore and admin tools */}
    <TabBtn active={tab==="data"}      onClick={() => setTab("data")}>Data</TabBtn>
        {/* Quick link to WhatsApp management */}
        <a href="/admin/wa-logs" className="px-3 py-2 rounded-2xl text-sm border" title="Open WhatsApp logs & sender">WhatsApp</a>
        {/* Quick link to Supply History (role-wide) */}
        <a href="/admin/supply-history" className="px-3 py-2 rounded-2xl text-sm border" title="Browse role-wide supply history">Supply History</a>
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
                      return (
                        <label
                          key={`tick-${p.id}`}
                          className={`inline-flex items-center gap-2 text-xs border rounded-xl px-3 py-2 cursor-pointer ${checked ? "bg-black text-white" : ""}`}
                          title={p.name}
                          onClick={(e) => {
                            e.preventDefault();
                            toggleScopeProduct(displayCode, p.key);
                          }}
                        >
                          <input
                            type="checkbox"
                            className="pointer-events-none"
                            readOnly
                            checked={checked}
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
                      {quickAddOptions.map(p => (
                        <option key={`qa-${p.id}`} value={p.key}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- PRODUCTS (global) ---------- */}
      {tab === "products" && (
        <section className="rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Products & Prices</h2>
            <div className="flex gap-2">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addProduct}>+ Add product</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={saveProductsNow}>Submit / Save</button>
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={() => setProducts(seedDefaultProducts())}>
                Reset defaults
              </button>
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
       <input className="input-mobile border rounded-xl p-2 w-44"
                             value={p.key}
                             onChange={e => updateProduct(p.id, { key: e.target.value })}
                             placeholder="unique key (e.g., beef)"/>
                    </td>
                    <td>
       <input className="input-mobile border rounded-xl p-2 w-56"
                             value={p.name}
                             onChange={e => updateProduct(p.id, { name: e.target.value })}
                             placeholder="Display name"/>
                    </td>
                    <td>
          <select className="input-mobile border rounded-xl p-2"
                              value={p.unit}
                              onChange={e => updateProduct(p.id, { unit: e.target.value as Unit })}>
                        <option value="kg">kg</option>
                        <option value="pcs">pcs</option>
                      </select>
                    </td>
                    <td>
       <input className="input-mobile border rounded-xl p-2 w-36" type="number" min={0} step={1}
                             value={p.sellPrice}
                             onChange={e => updateProduct(p.id, { sellPrice: n(e.target.value) })}
                             placeholder="Ksh"/>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={p.active}
                               onChange={e => updateProduct(p.id, { active: e.target.checked })}/>
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
            <p className="text-xs text-gray-600 mt-2">
              These prices are global defaults; per-outlet overrides live in the Outlet Pricebook tab.
            </p>
          </div>
        </section>
      )}

      {/* ---------- OUTLET PRICEBOOK ---------- */}
      {tab === "pricebook" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Outlet Pricebook</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Outlet</label>
              <select
                className="input-mobile border rounded-xl p-2 text-sm"
                value={pbOutlet}
                onChange={(e)=>setPbOutlet(e.target.value)}
              >
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
                            <input
                              className="input-mobile border rounded-xl p-2 w-36"
                              type="number" min={0} step={1}
                              value={row.sellPrice}
                              onChange={e=>setPBRow(pbOutlet, p.key, { sellPrice: n(e.target.value) })}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.active}
                              onChange={e=>setPBRow(pbOutlet, p.key, { active: e.target.checked })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------- SUPPLY VIEW (read-only) ---------- */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Supply View</h2>
            <div className="flex items-center gap-2">
              <input
                className="input-mobile border rounded-xl p-2 text-sm"
                type="date"
                value={supDate}
                onChange={(e)=>setSupDate(e.target.value)}
              />
              <select
                className="input-mobile border rounded-xl p-2 text-sm"
                value={supOutletName}
                onChange={(e)=>setSupOutletName(e.target.value)}
              >
                <option value={ALL}>All outlets</option>
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
                {supplyItems.length === 0 ? (
                  <tr><td className="py-3 text-gray-500" colSpan={5}>No opening recorded by Supplier for this date/outlet.</td></tr>
                ) : (
                  supplyItems.map((r, i) => (
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
              {supplyItems.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Totals</td>
                    <td>{fmt(supTotals.qty)}</td>
                    <td></td>
                    <td></td>
                    <td>{fmt(supTotals.amount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">Read-only mirror of supplier opening for attendants.</p>
        </section>
      )}

      {/* ---------- REPORTS (read-only) ---------- */}
      {tab === "reports" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3 mobile-scroll-x">
            <h2 className="font-semibold">Reports</h2>
            <div className="flex items-center gap-2">
              <input
                className="input-mobile border rounded-xl p-2 text-sm"
                type="date"
                value={repDate}
                onChange={(e)=>setRepDate(e.target.value)}
              />
              <select
                className="input-mobile border rounded-xl p-2 text-sm"
                value={repMode}
                onChange={(e)=>setRepMode(e.target.value as RangeMode)}
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
                  {repRows.length === 0 ? (
                    <tr><td className="py-3 text-gray-500" colSpan={7}>No outlets.</td></tr>
                ) : (
                  repRows.map(r => (
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
              {repRows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">Totals</td>
                    <td>{fmt(repTotals.expectedKsh)}</td>
                    <td>{fmt(repTotals.depositedKsh)}</td>
                    <td>{fmt(repTotals.expensesKsh)}</td>
                    <td>{fmt(repTotals.cashAtTill)}</td>
                    <td>{fmt(repTotals.varianceKsh)}</td>
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
                  {salesByItem.length === 0 ? (
                    <tr><td className="py-3 text-gray-500" colSpan={5}>No data for range.</td></tr>
                  ) : salesByItem.map(r => (
                    <tr key={r.key} className="border-b">
                      <td className="py-2">{r.name}</td>
                      <td>{fmt(r.soldQty)}</td>
                      <td>{fmt(r.wasteQty)}</td>
                      <td>{r.unit}</td>
                      <td>{fmt(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                {salesByItem.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="py-2">Totals</td>
                      <td>{fmt(salesByItem.reduce((a,r)=>a+r.soldQty,0))}</td>
                      <td>{fmt(salesByItem.reduce((a,r)=>a+r.wasteQty,0))}</td>
                      <td></td>
                      <td>{fmt(salesByItem.reduce((a,r)=>a+r.revenue,0))}</td>
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
                  {expensesMonitor.perOutlet.map(row => (
                    <tr key={row.outlet} className="border-b">
                      <td className="py-2">{row.outlet}</td>
                      <td>{fmt(row.total)}</td>
                      <td>
                        <button className="btn-mobile border rounded-lg px-2 py-1 text-xs" onClick={()=>raiseExpenseDispute(row.outlet)}>
                          Dispute/Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2">All outlets</td>
                    <td>{fmt(expensesMonitor.totalAll)}</td>
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
              <KPI label="Revenue (Ksh)"        value={fmt(profitEstimate.revenue)} />
              <KPI label="Supply Cost (Ksh)"    value={fmt(profitEstimate.supplyTotal)} />
              <KPI label="Gross Profit (Ksh)"   value={fmt(profitEstimate.grossProfit)} />
              <KPI label="Expenses (Ksh)"       value={fmt(profitEstimate.expensesTotal)} />
              <KPI label="Net After Exp (Ksh)"  value={fmt(profitEstimate.netAfterExpenses)} />
            </div>
          </div>
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
          <h2 className="font-semibold mb-3">Backup / Restore</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border p-3">
              <h3 className="font-medium mb-2">Current Settings (read-only)</h3>
              <textarea className="w-full h-64 border rounded-xl p-2 text-xs" readOnly value={payload} />
              <div className="mt-2 flex gap-2 mobile-scroll-x">
                <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={exportJSON}>Download JSON</button>
                <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={resetDefaults}>Reset Defaults</button>
                <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={clearAll}>Clear All</button>
                {/* Thin persistence helpers */}
                <button
                  className="btn-mobile border rounded-xl px-3 py-2 text-sm"
                  title="Push all admin keys to database"
                  onClick={async () => {
                    try { await pushAllToDB(); alert("Pushed all admin settings to DB ✅"); }
                    catch { alert("Failed to push to DB. Check network/DB."); }
                  }}
                >
                  Force Sync to DB
                </button>
                <button
                  className="btn-mobile border rounded-xl px-3 py-2 text-sm"
                  title="Reload admin keys from database into localStorage"
                  onClick={async () => {
                    try { await hydrateLocalStorageFromDB(); alert("Hydrated from DB ✅. Reload to reflect in UI."); }
                    catch { alert("Failed to hydrate from DB. Check network/DB."); }
                  }}
                >
                  Refresh from DB
                </button>
                <button
                  className="btn-mobile border rounded-xl px-3 py-2 text-sm"
                  title="Check DB persistence health"
                  onClick={async () => {
                    try {
                      const r = await fetch("/api/admin/persistence/health", { cache: "no-store" });
                      const j = await r.json().catch(()=>null as any);
                      alert("Health: " + JSON.stringify(j));
                    } catch {}
                  }}
                >
                  Check DB Health
                </button>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <h3 className="font-medium mb-2">Import Settings</h3>
              <textarea className="w-full h-64 border rounded-xl p-2 text-xs"
                        placeholder='Paste JSON here…'
                        value={importText}
                        onChange={e => setImportText(e.target.value)} />
              <div className="mt-2">
                <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={importJSON}>Import JSON</button>
              </div>
            </div>
          </div>

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

"use client";

import React, { useEffect, useMemo, useState } from "react";

/** =============== Types =============== */
type Unit = "kg" | "pcs";

type Product = {
  id: string;
  key: string;         // stable key used by other pages, e.g. "beef"
  name: string;
  unit: Unit;
  sellPrice: number;   // default/base sell price
  active: boolean;
};

type Outlet = {
  id: string;
  name: string;        // "Bright", "Baraka A", ...
  code: string;        // optional base code for the outlet
  active: boolean;
};

type FixedExpense = {
  id: string;
  name: string;        // "Rent", "Electricity", ...
  amount: number;      // Ksh
  frequency: "daily" | "monthly";
  active: boolean;
};

type TillType = "TILL" | "PAYBILL";
type TillConfig = {
  shortcode: string;
  type: TillType;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  callbackUrl: string;
  resultUrl: string;
  queueTimeoutUrl: string;
};
type OutletTillRow = {
  outletId: string;
  outletName: string;
  config: TillConfig;
};

/** Codes (staff) & assignments */
type Role = "attendant" | "supervisor" | "supplier";
type CodeRow = {
  id: string;
  name: string;        // person name
  code: string;        // login code (used on /attendant, /supervisor, /supplier)
  role: Role;          // NEW: role picker
  outletId: string;    // attached outlet (still useful for all roles)
  products: string[];  // product keys they manage (mainly for attendants)
  active: boolean;
};

type AdminTab =
  | "outlets"
  | "codes"
  | "products"
  | "expenses"
  | "tills"
  | "transfer"
  | "data"
  | "supply"
  | "reports";

/** =============== Storage Keys =============== */
const K_OUTLETS       = "admin_outlets";
const K_PRODUCTS      = "admin_products";
const K_EXPENSES      = "admin_expenses";
const K_TILLS         = "admin_tills";
const K_CODES         = "admin_staff";          // codes for all roles live here
const K_PRICEBOOK     = "admin_pricebook";      // { [outletId]: { [productKey]: number } }
const K_TILL_BALANCES = "admin_till_balances";  // { [outletId]: number } — updated by your API job

/** =============== Defaults =============== */
function rid() { return Math.random().toString(36).slice(2); }
function n(v: string) { return v === "" ? 0 : Number(v); }
function blankTill(): TillConfig {
  return {
    shortcode: "",
    type: "PAYBILL",
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    callbackUrl: "",
    resultUrl: "",
    queueTimeoutUrl: "",
  };
}
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

/** Parse + Save with safety */
function parseLS<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; }
  catch { return null; }
}
function saveLS<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** =============== Page =============== */
export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("outlets");

  const [outlets, setOutlets]   = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);
  const [tills, setTills]       = useState<OutletTillRow[]>([]);
  const [codes, setCodes]       = useState<CodeRow[]>([]);
  /** pricebook: outletId -> (productKey -> sellPrice) */
  const [pricebook, setPricebook] = useState<Record<string, Record<string, number>>>({});
  /** balance map for Reports (feed this from your API worker) */
  const [tillBalances, setTillBalances] = useState<Record<string, number>>({});

  // Data tab helpers
  const payload = useMemo(
    () => JSON.stringify({ outlets, products, expenses, tills, codes, pricebook, tillBalances }, null, 2),
    [outlets, products, expenses, tills, codes, pricebook, tillBalances]
  );
  const [importText, setImportText] = useState("");

  /** Load on first mount */
  useEffect(() => {
    const o = parseLS<Outlet[]>(K_OUTLETS)   ?? seedDefaultOutlets();
    const p = parseLS<Product[]>(K_PRODUCTS) ?? seedDefaultProducts();
    const e = parseLS<FixedExpense[]>(K_EXPENSES) ?? seedDefaultExpenses();
    const t = parseLS<OutletTillRow[]>(K_TILLS) ?? [];
    const c = parseLS<CodeRow[]>(K_CODES) ?? [];
    const pb = parseLS<Record<string, Record<string, number>>>(K_PRICEBOOK) ?? {};
    const bal = parseLS<Record<string, number>>(K_TILL_BALANCES) ?? {};

    // ensure we have a till row for each outlet
    const byId = new Map((t || []).map(r => [r.outletId, r]));
    const mergedTills: OutletTillRow[] = o.map(out => {
      const existing = byId.get(out.id);
      return existing
        ? { ...existing, outletName: out.name }
        : { outletId: out.id, outletName: out.name, config: blankTill() };
    });

    // ensure pricebook has rows for all outlets/products
    const fixedPB: Record<string, Record<string, number>> = { ...pb };
    for (const out of o) {
      if (!fixedPB[out.id]) fixedPB[out.id] = {};
      for (const prod of p) {
        if (typeof fixedPB[out.id][prod.key] !== "number") {
          fixedPB[out.id][prod.key] = prod.sellPrice; // seed with product base price
        }
      }
    }

    // migrate any legacy codes missing role -> default to attendant
    const migratedCodes: CodeRow[] = (c || []).map((row: any) => ({
      id: row.id ?? rid(),
      name: row.name ?? "",
      code: row.code ?? "",
      role: (row.role as Role) ?? "attendant",
      outletId: row.outletId ?? "",
      products: Array.isArray(row.products) ? row.products : [],
      active: typeof row.active === "boolean" ? row.active : true,
    }));

    setOutlets(o);
    setProducts(p);
    setExpenses(e);
    setTills(mergedTills);
    setCodes(migratedCodes);
    setPricebook(fixedPB);
    setTillBalances(bal);
  }, []);

  /** Save on changes */
  useEffect(() => { saveLS(K_OUTLETS, outlets); }, [outlets]);
  useEffect(() => { saveLS(K_PRODUCTS, products); }, [products]);
  useEffect(() => { saveLS(K_EXPENSES, expenses); }, [expenses]);
  useEffect(() => { saveLS(K_TILLS, tills); }, [tills]);
  useEffect(() => { saveLS(K_CODES, codes); }, [codes]);
  useEffect(() => { saveLS(K_PRICEBOOK, pricebook); }, [pricebook]);
  useEffect(() => { saveLS(K_TILL_BALANCES, tillBalances); }, [tillBalances]);

  /** CRUD — Outlets */
  const addOutlet = () => setOutlets(v => {
    const newOut = { id: rid(), name: "", code: "", active: true };
    setTills(prev => [...prev, { outletId: newOut.id, outletName: newOut.name, config: blankTill() }]);
    setPricebook(prev => ({ ...prev, [newOut.id]: Object.fromEntries(products.map(p => [p.key, p.sellPrice])) }));
    return [...v, newOut];
  });
  const removeOutlet = (id: string) => {
    setOutlets(v => v.filter(x => x.id !== id));
    setTills(v => v.filter(x => x.outletId !== id));
    setCodes(v => v.map(s => s.outletId === id ? { ...s, outletId: "" } : s));
    setPricebook(v => {
      const cp = { ...v };
      delete cp[id];
      return cp;
    });
    setTillBalances(v => {
      const cp = { ...v };
      delete cp[id];
      return cp;
    });
  };
  const updateOutlet = (id: string, patch: Partial<Outlet>) =>
    setOutlets(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  /** CRUD — Products */
  const addProduct = () => {
    const newP: Product = { id: rid(), key: "", name: "", unit: "kg", sellPrice: 0, active: true };
    setProducts(v => [...v, newP]);
    // add into pricebook for all outlets
    setPricebook(pb => {
      const cp = { ...pb };
      for (const out of outlets) {
        cp[out.id] = cp[out.id] || {};
        cp[out.id][newP.key] = newP.sellPrice; // if key changes later UI will realign
      }
      return cp;
    });
  };
  const removeProduct = (id: string) => {
    const prod = products.find(p => p.id === id);
    setProducts(v => v.filter(x => x.id !== id));
    if (prod) {
      setCodes(list => list.map(c => ({ ...c, products: c.products.filter(k => k !== prod.key) })));
      setPricebook(pb => {
        const cp = { ...pb };
        for (const outId of Object.keys(cp)) {
          if (cp[outId]) delete cp[outId][prod.key];
        }
        return cp;
      });
    }
  };
  const updateProduct = (id: string, patch: Partial<Product>) => {
    setProducts(v => v.map(x => x.id === id ? { ...x, ...patch } : x));
    // if key changed, reflect in pricebook & codes
    const prev = products.find(p => p.id === id);
    if (prev && patch.key && patch.key !== prev.key) {
      setPricebook(pb => {
        const cp = { ...pb };
        for (const outId of Object.keys(cp)) {
          if (typeof cp[outId][prev.key] !== "undefined") {
            cp[outId][patch.key] = cp[outId][prev.key];
            delete cp[outId][prev.key];
          } else {
            cp[outId][patch.key] = prev.sellPrice;
          }
        }
        return cp;
      });
      setCodes(list => list.map(c => ({
        ...c,
        products: c.products.map(k => k === prev.key ? patch.key! : k),
      })));
    }
  };

  /** CRUD — Expenses */
  const addExpense = () => setExpenses(v => [...v, { id: rid(), name: "", amount: 0, frequency: "monthly", active: true }]);
  const removeExpense = (id: string) => setExpenses(v => v.filter(x => x.id !== id));
  const updateExpense = (id: string, patch: Partial<FixedExpense>) =>
    setExpenses(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  /** Tills */
  const updateTill = (outletId: string, patch: Partial<TillConfig>) =>
    setTills(rows => rows.map(r => r.outletId === outletId ? ({ ...r, config: { ...r.config, ...patch } }) : r));

  /** Codes (for all roles) */
  const addCode = () => setCodes(v => [...v, { id: rid(), name: "", code: "", role: "attendant", outletId: "", products: [], active: true }]);
  const removeCode = (id: string) => setCodes(v => v.filter(x => x.id !== id));
  const updateCode = (id: string, patch: Partial<CodeRow>) =>
    setCodes(v => v.map(x => x.id === id ? { ...x, ...patch } : x));

  /** Transfer Codes helper */
  const transferCodeOutlet = (codeId: string, toOutletId: string) => {
    setCodes(list => list.map(c => c.id === codeId ? { ...c, outletId: toOutletId } : c));
  };

  /** Pricebook helpers */
  const setOutletProductPrice = (outletId: string, productKey: string, value: number) => {
    setPricebook(pb => ({
      ...pb,
      [outletId]: { ...(pb[outletId] || {}), [productKey]: value },
    }));
  };

  /** Backup/Restore */
  const exportJSON = () => {
    const blob = new Blob([payload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `admin-settings-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJSON = () => {
    try {
      const parsed = JSON.parse(importText);
      if (parsed.outlets)      setOutlets(parsed.outlets);
      if (parsed.products)     setProducts(parsed.products);
      if (parsed.expenses)     setExpenses(parsed.expenses);
      if (parsed.tills)        setTills(parsed.tills);
      if (parsed.codes)        setCodes(parsed.codes);
      if (parsed.pricebook)    setPricebook(parsed.pricebook);
      if (parsed.tillBalances) setTillBalances(parsed.tillBalances);
      alert("Imported settings successfully.");
    } catch (e: any) {
      alert("Failed to import: " + e.message);
    }
  };
  const resetDefaults = () => {
    if (!confirm("Reset ALL admin settings to defaults?")) return;
    const o = seedDefaultOutlets();
    const p = seedDefaultProducts();
    setOutlets(o);
    setProducts(p);
    setExpenses(seedDefaultExpenses());
    setTills(o.map(out => ({ outletId: out.id, outletName: out.name, config: blankTill() })));
    setCodes([]);
    setPricebook(Object.fromEntries(o.map(out => [out.id, Object.fromEntries(p.map(pr => [pr.key, pr.sellPrice]))])));
    setTillBalances({});
  };
  const clearAll = () => {
    if (!confirm("Remove ALL admin settings from this browser?")) return;
    localStorage.removeItem(K_OUTLETS);
    localStorage.removeItem(K_PRODUCTS);
    localStorage.removeItem(K_EXPENSES);
    localStorage.removeItem(K_TILLS);
    localStorage.removeItem(K_CODES);
    localStorage.removeItem(K_PRICEBOOK);
    localStorage.removeItem(K_TILL_BALANCES);
    setOutlets([]); setProducts([]); setExpenses([]); setTills([]); setCodes([]); setPricebook({}); setTillBalances({});
  };

  /** Totals */
  const sumTillBalances = Object.values(tillBalances || {}).reduce((a, b) => a + (Number(b) || 0), 0);

  /** UI bits */
  const outletName = (id: string) => outlets.find(o => o.id === id)?.name || "";

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Administrator Dashboard</h1>
          <p className="text-xs text-gray-600">Flow: Create <b>Outlet</b> → Create <b>Code</b> (choose role) → Assign <b>Products</b> & Prices per Outlet.</p>
        </div>
        <nav className="flex gap-2">
          <TabBtn active={tab==="outlets"}  onClick={() => setTab("outlets")}>Outlets</TabBtn>
          <TabBtn active={tab==="codes"}    onClick={() => setTab("codes")}>Codes</TabBtn>
          <TabBtn active={tab==="products"} onClick={() => setTab("products")}>Products & Prices</TabBtn>
          <TabBtn active={tab==="expenses"} onClick={() => setTab("expenses")}>Fixed Expenses</TabBtn>
          <TabBtn active={tab==="tills"}    onClick={() => setTab("tills")}>Tills & API</TabBtn>
          <TabBtn active={tab==="transfer"} onClick={() => setTab("transfer")}>Transfer Codes</TabBtn>
          <TabBtn active={tab==="data"}     onClick={() => setTab("data")}>Backup / Restore</TabBtn>
          <TabBtn active={tab==="supply"}   onClick={() => setTab("supply")}>Supply & Reports</TabBtn>
          <TabBtn active={tab==="reports"}  onClick={() => setTab("reports")}>Reports</TabBtn>
        </nav>
      </header>

      {/* OUTLETS */}
      {tab === "outlets" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Create Outlets</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addOutlet}>+ Add outlet</button>
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={resetDefaults}>Reset defaults</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Base Code (optional)</th>
                  <th>Status</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {outlets.length === 0 && <tr><td colSpan={4} className="py-3 text-gray-500">No outlets yet.</td></tr>}
                {outlets.map(o => (
                  <tr key={o.id} className="border-b">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-56" value={o.name} onChange={e=>updateOutlet(o.id,{name:e.target.value})} placeholder="Outlet name"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-40" value={o.code} onChange={e=>updateOutlet(o.id,{code:e.target.value})} placeholder="e.g. BR1234"/>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={o.active} onChange={e=>updateOutlet(o.id,{active:e.target.checked})}/>
                        Active
                      </label>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>removeOutlet(o.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">Step 1: Create outlets, then add codes (choose role) and assign products for attendants.</p>
          </div>
        </section>
      )}

      {/* CODES (login codes for ALL roles) */}
      {tab === "codes" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Create Codes & Assign (Attendant / Supervisor / Supplier)</h2>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addCode}>+ Add code</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Code</th>
                  <th>Role</th>
                  <th>Outlet</th>
                  <th>Products (for attendants)</th>
                  <th>Status</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {codes.length === 0 && <tr><td colSpan={7} className="py-3 text-gray-500">No codes yet.</td></tr>}
                {codes.map(c => (
                  <tr key={c.id} className="border-b align-top">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-44" value={c.name} onChange={(e)=>updateCode(c.id,{name:e.target.value})} placeholder="Person name"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-36" value={c.code} onChange={(e)=>updateCode(c.id,{code:e.target.value})} placeholder="Unique code"/>
                    </td>
                    <td>
                      <select className="border rounded-xl p-2 w-40" value={c.role} onChange={(e)=>updateCode(c.id,{role: e.target.value as Role})}>
                        <option value="attendant">Attendant</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="supplier">Supplier</option>
                      </select>
                    </td>
                    <td>
                      <select className="border rounded-xl p-2 w-44" value={c.outletId} onChange={(e)=>updateCode(c.id,{outletId:e.target.value})}>
                        <option value="">Select outlet…</option>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2 max-w-xl">
                        {products.filter(p=>p.active).map(p=>{
                          const checked = c.products.includes(p.key);
                          return (
                            <label key={p.id} className="inline-flex items-center gap-1 border rounded-xl px-2 py-1">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={c.role !== "attendant"}
                                onChange={(e)=>{
                                  const set = new Set(c.products);
                                  if(e.target.checked) set.add(p.key); else set.delete(p.key);
                                  updateCode(c.id,{products:Array.from(set)});
                                }}
                              />
                              <span className="text-xs">{p.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={c.active} onChange={e=>updateCode(c.id,{active:e.target.checked})}/>
                        Active
                      </label>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>removeCode(c.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              Use role:
              <b> Attendant</b> (needs product assignments),
              <b> Supervisor</b> and <b>Supplier</b> (product list ignored, still link them to a home outlet).
            </p>
          </div>
        </section>
      )}

      {/* PRODUCTS & OUTLET PRICEBOOK */}
      {tab === "products" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Products & Prices</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addProduct}>+ Add product</button>
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={()=>setProducts(seedDefaultProducts())}>Reset defaults</button>
            </div>
          </div>

          {/* Base catalog */}
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Key</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Base Sell Price</th>
                  <th>Status</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-500">No products yet.</td></tr>}
                {products.map(p => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">
                      <input className="border rounded-xl p-2 w-40" value={p.key} onChange={e=>updateProduct(p.id,{key:e.target.value})} placeholder="unique key"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-56" value={p.name} onChange={e=>updateProduct(p.id,{name:e.target.value})} placeholder="Display name"/>
                    </td>
                    <td>
                      <select className="border rounded-xl p-2" value={p.unit} onChange={e=>updateProduct(p.id,{unit:e.target.value as Unit})}>
                        <option value="kg">kg</option>
                        <option value="pcs">pcs</option>
                      </select>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-32" type="number" min={0} step={1}
                        value={p.sellPrice} onChange={e=>updateProduct(p.id,{sellPrice:n(e.target.value)})}/>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={p.active} onChange={e=>updateProduct(p.id,{active:e.target.checked})}/>
                        Active
                      </label>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>removeProduct(p.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Outlet pricebook matrix */}
          <h3 className="font-semibold mb-2">Outlet Pricebook (override per outlet)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Product</th>
                  {outlets.map(o => (<th key={o.id}>{o.name}</th>))}
                </tr>
              </thead>
              <tbody>
                {products.filter(p=>p.active).map(p => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.name}</td>
                    {outlets.map(o => (
                      <td key={o.id}>
                        <input
                          className="border rounded-xl p-2 w-28"
                          type="number" min={0} step={1}
                          value={pricebook[o.id]?.[p.key] ?? p.sellPrice}
                          onChange={(e)=>setOutletProductPrice(o.id, p.key, n(e.target.value))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">Attendant expected sales will use these outlet prices.</p>
        </section>
      )}

      {/* EXPENSES */}
      {tab === "expenses" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Fixed Expenses</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addExpense}>+ Add expense</button>
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={()=>setExpenses(seedDefaultExpenses())}>Reset defaults</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Amount (Ksh)</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-500">No expenses yet.</td></tr>}
                {expenses.map(e => (
                  <tr key={e.id} className="border-b">
                    <td className="py-2"><input className="border rounded-xl p-2 w-56" value={e.name} onChange={ev=>updateExpense(e.id,{name:ev.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-36" type="number" min={0} step={1} value={e.amount} onChange={ev=>updateExpense(e.id,{amount:n(ev.target.value)})}/></td>
                    <td>
                      <select className="border rounded-xl p-2" value={e.frequency} onChange={ev=>updateExpense(e.id,{frequency:ev.target.value as FixedExpense["frequency"]})}>
                        <option value="daily">daily</option>
                        <option value="monthly">monthly</option>
                      </select>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={e.active} onChange={ev=>updateExpense(e.id,{active:ev.target.checked})}/>
                        Active
                      </label>
                    </td>
                    <td><button className="text-xs border rounded-lg px-2 py-1" onClick={()=>removeExpense(e.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TILLS & API */}
      {tab === "tills" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Tills & Daraja API</h2>
            <div className="text-xs text-gray-600">Configure MPesa credentials per outlet.</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Outlet</th>
                  <th>Shortcode</th>
                  <th>Type</th>
                  <th>Consumer Key</th>
                  <th>Consumer Secret</th>
                  <th>Passkey</th>
                  <th>Callback URL</th>
                  <th>Result URL</th>
                  <th>Timeout URL</th>
                </tr>
              </thead>
              <tbody>
                {tills.length === 0 && <tr><td colSpan={9} className="py-3 text-gray-500">No outlets found.</td></tr>}
                {tills.map(row => (
                  <tr key={row.outletId} className="border-b">
                    <td className="py-2 font-medium">{row.outletName || "(unnamed)"}</td>
                    <td><input className="border rounded-xl p-2 w-36" value={row.config.shortcode} onChange={e=>updateTill(row.outletId,{shortcode:e.target.value})}/></td>
                    <td>
                      <select className="border rounded-xl p-2" value={row.config.type} onChange={e=>updateTill(row.outletId,{type:e.target.value as TillType})}>
                        <option value="PAYBILL">PAYBILL</option>
                        <option value="TILL">TILL</option>
                      </select>
                    </td>
                    <td><input className="border rounded-xl p-2 w-44" value={row.config.consumerKey} onChange={e=>updateTill(row.outletId,{consumerKey:e.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-44" value={row.config.consumerSecret} onChange={e=>updateTill(row.outletId,{consumerSecret:e.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-44" value={row.config.passkey} onChange={e=>updateTill(row.outletId,{passkey:e.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-60" value={row.config.callbackUrl} onChange={e=>updateTill(row.outletId,{callbackUrl:e.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-60" value={row.config.resultUrl} onChange={e=>updateTill(row.outletId,{resultUrl:e.target.value})}/></td>
                    <td><input className="border rounded-xl p-2 w-60" value={row.config.queueTimeoutUrl} onChange={e=>updateTill(row.outletId,{queueTimeoutUrl:e.target.value})}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">Your background job can update <code>admin_till_balances</code> with live balances.</p>
        </section>
      )}

      {/* TRANSFER CODES */}
      {tab === "transfer" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Transfer Codes Between Outlets</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Code</th>
                  <th>Holder</th>
                  <th>Role</th>
                  <th>Current Outlet</th>
                  <th>Move To</th>
                </tr>
              </thead>
              <tbody>
                {codes.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-500">No codes available.</td></tr>}
                {codes.map(c => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 font-medium">{c.code || "—"}</td>
                    <td>{c.name || "—"}</td>
                    <td className="capitalize">{c.role}</td>
                    <td>{outletName(c.outletId) || "—"}</td>
                    <td>
                      <select className="border rounded-xl p-2 w-44" value="" onChange={(e)=>{ if(e.target.value) transferCodeOutlet(c.id, e.target.value); }}>
                        <option value="">Select outlet…</option>
                        {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">Transfers update instantly. Product assignments matter to attendants only.</p>
        </section>
      )}

      {/* BACKUP / RESTORE */}
      {tab === "data" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Backup / Restore</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border p-3">
              <h3 className="font-medium mb-2">Current Settings (read-only)</h3>
              <textarea className="w-full h-64 border rounded-xl p-2 text-xs" readOnly value={payload} />
              <div className="mt-2 flex gap-2">
                <button className="border rounded-xl px-3 py-2 text-sm" onClick={exportJSON}>Download JSON</button>
                <button className="border rounded-xl px-3 py-2 text-sm" onClick={resetDefaults}>Reset Defaults</button>
                <button className="border rounded-xl px-3 py-2 text-sm" onClick={clearAll}>Clear All</button>
              </div>
            </div>
            <div className="rounded-xl border p-3">
              <h3 className="font-medium mb-2">Import Settings</h3>
              <textarea className="w-full h-64 border rounded-xl p-2 text-xs" placeholder="Paste JSON here…" value={importText} onChange={e=>setImportText(e.target.value)} />
              <div className="mt-2">
                <button className="border rounded-xl px-3 py-2 text-sm" onClick={importJSON}>Import JSON</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SUPPLY QUICK LINKS */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Supply & Reports</h2>
          <div className="flex flex-wrap gap-3">
            <a href="/supplier" className="border rounded-xl px-4 py-2 text-sm hover:bg-gray-50">Open Supplier Dashboard</a>
            <a href="/admin/reports" className="border rounded-xl px-4 py-2 text-sm hover:bg-gray-50">Go to Admin Reports</a>
          </div>
        </section>
      )}

      {/* REPORTS */}
      {tab === "reports" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Reports</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KPI label="Active Outlets" value={String(outlets.filter(o=>o.active).length)} />
            <KPI label="Active Codes"   value={String(codes.filter(c=>c.active).length)} />
            <KPI label="Active Products" value={String(products.filter(p=>p.active).length)} />
            <KPI label="Sum Till Balances (Ksh)" value={sumTillBalances.toLocaleString()} />
          </div>

          <h3 className="font-semibold mb-2">Till Balances by Outlet</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b"><th className="py-2">Outlet</th><th>Balance (Ksh)</th></tr></thead>
              <tbody>
                {outlets.map(o => (
                  <tr key={o.id} className="border-b">
                    <td className="py-2">{o.name}</td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-40"
                        value={String(tillBalances[o.id] ?? 0)}
                        onChange={(e)=>setTillBalances(prev=>({ ...prev, [o.id]: n(e.target.value) }))}
                        placeholder="(feed from API)"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-600 mt-2">
            This table reads from <code>admin_till_balances</code>. Your Daraja/partner API job can update that key so Admin always sees
            the exact current balances and the sum above.
          </p>
        </section>
      )}
    </main>
  );
}

/** UI Bits */
function TabBtn(props: React.PropsWithChildren<{active:boolean; onClick():void;}>) {
  return (
    <button
      onClick={props.onClick}
      className={`px-3 py-2 rounded-2xl text-sm border ${props.active ? "bg-black text-white" : ""}`}
    >
      {props.children}
    </button>
  );
}
function KPI({label, value}:{label:string; value:string}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

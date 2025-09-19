"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  frequency: "daily" | "monthly";
  active: boolean;
};

type AdminTab = "outlets" | "products" | "expenses" | "data";

/** =============== Storage Keys =============== */
const K_OUTLETS  = "admin_outlets";
const K_PRODUCTS = "admin_products";
const K_EXPENSES = "admin_expenses";

/** =============== Defaults (match what you’ve been using) =============== */
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
  const [tab, setTab] = useState<AdminTab>("outlets");

  // Outlets
  const [outlets, setOutlets]   = useState<Outlet[]>([]);
  // Products
  const [products, setProducts] = useState<Product[]>([]);
  // Expenses
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);

  // Data tab helpers
  const payload = useMemo(() => JSON.stringify({ outlets, products, expenses }, null, 2), [outlets, products, expenses]);
  const [importText, setImportText] = useState("");

  /** ----- Load on first mount (or if storage empty, seed defaults) ----- */
  useEffect(() => {
    try {
      const o = parseLS<Outlet[]>(K_OUTLETS) ?? seedDefaultOutlets();
      const p = parseLS<Product[]>(K_PRODUCTS) ?? seedDefaultProducts();
      const e = parseLS<FixedExpense[]>(K_EXPENSES) ?? seedDefaultExpenses();
      setOutlets(o);
      setProducts(p);
      setExpenses(e);
    } catch {
      setOutlets(seedDefaultOutlets());
      setProducts(seedDefaultProducts());
      setExpenses(seedDefaultExpenses());
    }
  }, []);

  /** ----- Manual SAVE buttons (only addition) ----- */
  const saveOutletsNow  = () => { saveLS(K_OUTLETS, outlets);  alert("Outlets & Codes saved ✅"); };
  const saveProductsNow = () => { saveLS(K_PRODUCTS, products); alert("Products & Prices saved ✅"); };
  const saveExpensesNow = () => { saveLS(K_EXPENSES, expenses); alert("Fixed Expenses saved ✅"); };

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

  /** ----- Data tab actions ----- */
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
      if (parsed.outlets)  setOutlets(parsed.outlets);
      if (parsed.products) setProducts(parsed.products);
      if (parsed.expenses) setExpenses(parsed.expenses);
      alert("Imported settings successfully.");
    } catch (e: any) {
      alert("Failed to import: " + e.message);
    }
  };

  const resetDefaults = () => {
    if (!confirm("Reset ALL admin settings to defaults?")) return;
    setOutlets(seedDefaultOutlets());
    setProducts(seedDefaultProducts());
    setExpenses(seedDefaultExpenses());
  };

  const clearAll = () => {
    if (!confirm("Remove ALL admin settings from this browser?")) return;
    localStorage.removeItem(K_OUTLETS);
    localStorage.removeItem(K_PRODUCTS);
    localStorage.removeItem(K_EXPENSES);
    setOutlets([]);
    setProducts([]);
    setExpenses([]);
  };

  /** ----- Render ----- */
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Administrator Dashboard</h1>
        <nav className="flex gap-2">
          <TabBtn active={tab==="outlets"}  onClick={() => setTab("outlets")}>Outlets & Codes</TabBtn>
          <TabBtn active={tab==="products"} onClick={() => setTab("products")}>Products & Prices</TabBtn>
          <TabBtn active={tab==="expenses"} onClick={() => setTab("expenses")}>Fixed Expenses</TabBtn>
          <TabBtn active={tab==="data"}     onClick={() => setTab("data")}>Backup / Restore</TabBtn>
        </nav>
      </header>

      {tab === "outlets" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Outlets & Attendant Codes</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addOutlet}>+ Add outlet</button>
              {/* ONLY ADDITION BELOW */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={saveOutletsNow}>Submit / Save</button>
              {/* ONLY ADDITION ABOVE */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={() => setOutlets(seedDefaultOutlets())}>
                Reset defaults
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Login Code</th>
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
                      <input className="border rounded-xl p-2 w-56"
                             value={o.name}
                             onChange={e => updateOutlet(o.id, { name: e.target.value })}
                             placeholder="Outlet name"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-40"
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
                      <button className="text-xs border rounded-lg px-2 py-1" onClick={() => removeOutlet(o.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              These codes are used by the Attendant Login page to auto-map the outlet.
            </p>
          </div>
        </section>
      )}

      {tab === "products" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Products & Prices</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addProduct}>+ Add product</button>
              {/* ONLY ADDITION BELOW */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={saveProductsNow}>Submit / Save</button>
              {/* ONLY ADDITION ABOVE */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={() => setProducts(seedDefaultProducts())}>
                Reset defaults
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
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
                      <input className="border rounded-xl p-2 w-44"
                             value={p.key}
                             onChange={e => updateProduct(p.id, { key: e.target.value })}
                             placeholder="unique key (e.g., beef)"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-56"
                             value={p.name}
                             onChange={e => updateProduct(p.id, { name: e.target.value })}
                             placeholder="Display name"/>
                    </td>
                    <td>
                      <select className="border rounded-xl p-2"
                              value={p.unit}
                              onChange={e => updateProduct(p.id, { unit: e.target.value as Unit })}>
                        <option value="kg">kg</option>
                        <option value="pcs">pcs</option>
                      </select>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-36" type="number" min={0} step={1}
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
                      <button className="text-xs border rounded-lg px-2 py-1" onClick={() => removeProduct(p.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              These prices can be used by Attendant Dashboard to compute expected Ksh. (We can wire that next.)
            </p>
          </div>
        </section>
      )}

      {tab === "expenses" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Fixed Expenses</h2>
            <div className="flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={addExpense}>+ Add expense</button>
              {/* ONLY ADDITION BELOW */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={saveExpensesNow}>Submit / Save</button>
              {/* ONLY ADDITION ABOVE */}
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={() => setExpenses(seedDefaultExpenses())}>
                Reset defaults
              </button>
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
                      <input className="border rounded-xl p-2 w-56"
                             value={e.name}
                             onChange={ev => updateExpense(e.id, { name: ev.target.value })}
                             placeholder="Expense name"/>
                    </td>
                    <td>
                      <input className="border rounded-xl p-2 w-36" type="number" min={0} step={1}
                             value={e.amount}
                             onChange={ev => updateExpense(e.id, { amount: n(ev.target.value) })}
                             placeholder="Ksh"/>
                    </td>
                    <td>
                      <select className="border rounded-xl p-2"
                              value={e.frequency}
                              onChange={ev => updateExpense(e.id, { frequency: ev.target.value as FixedExpense["frequency"] })}>
                        <option value="daily">daily</option>
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
                      <button className="text-xs border rounded-lg px-2 py-1" onClick={() => removeExpense(e.id)}>✕</button>
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
              <textarea className="w-full h-64 border rounded-xl p-2 text-xs"
                        placeholder='Paste JSON here…'
                        value={importText}
                        onChange={e => setImportText(e.target.value)} />
              <div className="mt-2">
                <button className="border rounded-xl px-3 py-2 text-sm" onClick={importJSON}>Import JSON</button>
              </div>
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

/** =============== Helpers =============== */
function rid() { return Math.random().toString(36).slice(2); }
function n(v: string) { return v === "" ? 0 : Number(v); }

// Parse + Save with safety
function parseLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}
function saveLS<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

"use client";

import React, { useEffect, useMemo, useState } from "react";

/* =========================================================
   Types
   ========================================================= */
type Unit = "kg" | "pcs";

type Product = {
  id: string;
  key: string;        // stable key used across app: "beef", "goat", ...
  name: string;
  unit: Unit;
  defaultSellPrice: number; // base price if no outlet override
  active: boolean;
};

type Outlet = {
  id: string;
  name: string;       // "Bright", "Baraka A", ...
  active: boolean;
};

type StaffRole = "admin" | "supervisor" | "supplier" | "attendant";

type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  code: string;               // login code used on role pages
  outletId: string;           // which outlet they belong to
  productKeys: string[];      // products this person is accountable for
  active: boolean;
};

type FixedExpense = {
  id: string;
  name: string;
  amount: number;
  frequency: "daily" | "monthly";
  active: boolean;
};

/** Per-outlet price overrides:
 *  { [outletId]: { [productKey]: number } }
 */
type PriceOverrides = Record<string, Record<string, number>>;

type AdminTab =
  | "outlets"
  | "products"
  | "staff"
  | "supply"
  | "reports"
  | "expenses"
  | "data";

/* =========================================================
   Storage Keys
   ========================================================= */
const K_OUTLETS        = "admin_outlets_v2";
const K_PRODUCTS       = "admin_products_v2";
const K_STAFF          = "admin_staff_v2";
const K_PRICE_OVERRIDES= "admin_price_overrides_v2";
const K_EXPENSES       = "admin_fixed_expenses_v2";

/* =========================================================
   Helpers
   ========================================================= */
function rid(): string {
  return Math.random().toString(36).slice(2);
}
function toNum(v: string): number {
  return v === "" ? 0 : Number(v);
}
function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/* =========================================================
   Seeds (safe defaults)
   ========================================================= */
function seedOutlets(): Outlet[] {
  return [
    { id: rid(), name: "Bright",   active: true },
    { id: rid(), name: "Baraka A", active: true },
    { id: rid(), name: "Baraka B", active: true },
    { id: rid(), name: "Baraka C", active: true },
  ];
}
function seedProducts(): Product[] {
  return [
    { id: rid(), key: "beef",     name: "Beef",            unit: "kg",  defaultSellPrice: 740, active: true },
    { id: rid(), key: "goat",     name: "Goat (Cigon)",    unit: "kg",  defaultSellPrice: 900, active: true },
    { id: rid(), key: "liver",    name: "Liver",           unit: "kg",  defaultSellPrice: 900, active: true },
    { id: rid(), key: "kuku",     name: "Kuku (Chicken)",  unit: "kg",  defaultSellPrice: 900, active: true },
    { id: rid(), key: "matumbo",  name: "Matumbo",         unit: "kg",  defaultSellPrice: 0,   active: true },
    { id: rid(), key: "potatoes", name: "Potatoes (raw)",  unit: "kg",  defaultSellPrice: 150, active: true },
    { id: rid(), key: "samosas",  name: "Samosas",         unit: "pcs", defaultSellPrice: 60,  active: true },
    { id: rid(), key: "mutura",   name: "Mutura",          unit: "pcs", defaultSellPrice: 60,  active: true },
  ];
}
function seedExpenses(): FixedExpense[] {
  return [
    { id: rid(), name: "Wages",       amount: 0, frequency: "monthly", active: true },
    { id: rid(), name: "Rent",        amount: 0, frequency: "monthly", active: true },
    { id: rid(), name: "Electricity", amount: 0, frequency: "monthly", active: true },
  ];
}

/* =========================================================
   Component
   ========================================================= */
export default function AdminPage(): JSX.Element {
  const [tab, setTab] = useState<AdminTab>("outlets");

  // Core admin data
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [overrides, setOverrides] = useState<PriceOverrides>({});
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);

  // Load on mount
  useEffect(() => {
    setOutlets(loadLS<Outlet[]>(K_OUTLETS, seedOutlets()));
    setProducts(loadLS<Product[]>(K_PRODUCTS, seedProducts()));
    setStaff(loadLS<StaffMember[]>(K_STAFF, []));
    setOverrides(loadLS<PriceOverrides>(K_PRICE_OVERRIDES, {}));
    setExpenses(loadLS<FixedExpense[]>(K_EXPENSES, seedExpenses()));
  }, []);

  // Persist on change
  useEffect(() => saveLS(K_OUTLETS, outlets), [outlets]);
  useEffect(() => saveLS(K_PRODUCTS, products), [products]);
  useEffect(() => saveLS(K_STAFF, staff), [staff]);
  useEffect(() => saveLS(K_PRICE_OVERRIDES, overrides), [overrides]);
  useEffect(() => saveLS(K_EXPENSES, expenses), [expenses]);

  // Convenience lookups
  const outletById = useMemo(() => {
    const m: Record<string, Outlet> = {};
    for (const o of outlets) m[o.id] = o;
    return m;
  }, [outlets]);

  const productByKey = useMemo(() => {
    const m: Record<string, Product> = {};
    for (const p of products) m[p.key] = p;
    return m;
  }, [products]);

  /* ----------------------- OUTLETS CRUD ----------------------- */
  const addOutlet = (): void =>
    setOutlets((v) => [...v, { id: rid(), name: "", active: true }]);

  const updateOutlet = (id: string, patch: Partial<Outlet>): void =>
    setOutlets((v) => v.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const removeOutlet = (id: string): void =>
    setOutlets((v) => v.filter((o) => o.id !== id));

  /* ----------------------- PRODUCTS CRUD ---------------------- */
  const addProduct = (): void =>
    setProducts((v) => [
      ...v,
      {
        id: rid(),
        key: "",
        name: "",
        unit: "kg",
        defaultSellPrice: 0,
        active: true,
      },
    ]);

  const updateProduct = (id: string, patch: Partial<Product>): void =>
    setProducts((v) => v.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removeProduct = (id: string): void =>
    setProducts((v) => v.filter((p) => p.id !== id));

  // Per-outlet price overrides
  const getOverridePrice = (outletId: string, productKey: string): number => {
    return overrides[outletId]?.[productKey] ?? productByKey[productKey]?.defaultSellPrice ?? 0;
  };
  const setOverridePrice = (outletId: string, productKey: string, price: number): void => {
    setOverrides((prev) => {
      const next: PriceOverrides = { ...prev };
      if (!next[outletId]) next[outletId] = {};
      next[outletId][productKey] = price;
      return next;
    });
  };

  /* ----------------------- STAFF & CODES ---------------------- */
  const addStaff = (): void =>
    setStaff((v) => [
      ...v,
      {
        id: rid(),
        name: "",
        role: "attendant",
        code: "",
        outletId: outlets[0]?.id ?? "",
        productKeys: [],
        active: true,
      },
    ]);

  const updateStaff = (id: string, patch: Partial<StaffMember>): void =>
    setStaff((v) => v.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeStaff = (id: string): void =>
    setStaff((v) => v.filter((s) => s.id !== id));

  const toggleStaffProduct = (staffId: string, productKey: string): void => {
    setStaff((v) =>
      v.map((s) => {
        if (s.id !== staffId) return s;
        const has = s.productKeys.includes(productKey);
        return {
          ...s,
          productKeys: has
            ? s.productKeys.filter((k) => k !== productKey)
            : [...s.productKeys, productKey],
        };
      })
    );
  };

  /* ----------------------- EXPENSES CRUD ---------------------- */
  const addExpense = (): void =>
    setExpenses((v) => [
      ...v,
      { id: rid(), name: "", amount: 0, frequency: "monthly", active: true },
    ]);

  const updateExpense = (id: string, patch: Partial<FixedExpense>): void =>
    setExpenses((v) => v.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const removeExpense = (id: string): void =>
    setExpenses((v) => v.filter((e) => e.id !== id));

  /* ----------------------- Data Tab --------------------------- */
  const exportPayload = useMemo(
    () =>
      JSON.stringify(
        { outlets, products, priceOverrides: overrides, staff, expenses },
        null,
        2
      ),
    [outlets, products, overrides, staff, expenses]
  );

  const importData = (txt: string): void => {
    try {
      const parsed = JSON.parse(txt) as {
        outlets?: Outlet[];
        products?: Product[];
        priceOverrides?: PriceOverrides;
        staff?: StaffMember[];
        expenses?: FixedExpense[];
      };
      if (parsed.outlets) setOutlets(parsed.outlets);
      if (parsed.products) setProducts(parsed.products);
      if (parsed.priceOverrides) setOverrides(parsed.priceOverrides);
      if (parsed.staff) setStaff(parsed.staff);
      if (parsed.expenses) setExpenses(parsed.expenses);
      alert("Imported successfully.");
    } catch (e) {
      alert("Invalid JSON.");
    }
  };

  /* =========================================================
     Render
     ========================================================= */
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Administrator Dashboard</h1>
        <nav className="flex gap-2">
          <TabBtn active={tab === "outlets"} onClick={() => setTab("outlets")}>
            Outlets
          </TabBtn>
          <TabBtn active={tab === "products"} onClick={() => setTab("products")}>
            Products & Prices
          </TabBtn>
          <TabBtn active={tab === "staff"} onClick={() => setTab("staff")}>
            Staff & Codes
          </TabBtn>
          <TabBtn active={tab === "supply"} onClick={() => setTab("supply")}>
            Supply
          </TabBtn>
          <TabBtn active={tab === "reports"} onClick={() => setTab("reports")}>
            Reports
          </TabBtn>
          <TabBtn active={tab === "expenses"} onClick={() => setTab("expenses")}>
            Fixed Expenses
          </TabBtn>
          <TabBtn active={tab === "data"} onClick={() => setTab("data")}>
            Backup / Restore
          </TabBtn>
        </nav>
      </header>

      {/* ---------- OUTLETS ---------- */}
      {tab === "outlets" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Outlets</h2>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addOutlet}>
              + Add outlet
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Status</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {outlets.length === 0 && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={3}>
                      No outlets yet.
                    </td>
                  </tr>
                )}
                {outlets.map((o) => (
                  <tr key={o.id} className="border-b">
                    <td className="py-2">
                      <input
                        className="border rounded-xl p-2 w-56"
                        value={o.name}
                        onChange={(e) => updateOutlet(o.id, { name: e.target.value })}
                        placeholder="Outlet name"
                      />
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={o.active}
                          onChange={(e) => updateOutlet(o.id, { active: e.target.checked })}
                        />
                        Active
                      </label>
                    </td>
                    <td>
                      <button
                        className="text-xs border rounded-lg px-2 py-1"
                        onClick={() => removeOutlet(o.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              Create outlets first. Then assign codes/users to these outlets in the “Staff & Codes” tab.
            </p>
          </div>
        </section>
      )}

      {/* ---------- PRODUCTS & PER-OUTLET PRICES ---------- */}
      {tab === "products" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Products & Prices (per outlet)</h2>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addProduct}>
              + Add product
            </button>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Key</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Default Price (Ksh)</th>
                  <th>Status</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={6}>
                      No products yet.
                    </td>
                  </tr>
                )}
                {products.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">
                      <input
                        className="border rounded-xl p-2 w-44"
                        value={p.key}
                        onChange={(e) => updateProduct(p.id, { key: e.target.value })}
                        placeholder="unique key (e.g., beef)"
                      />
                    </td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-56"
                        value={p.name}
                        onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                        placeholder="Display name"
                      />
                    </td>
                    <td>
                      <select
                        className="border rounded-xl p-2"
                        value={p.unit}
                        onChange={(e) => updateProduct(p.id, { unit: e.target.value as Unit })}
                      >
                        <option value="kg">kg</option>
                        <option value="pcs">pcs</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-36"
                        type="number"
                        min={0}
                        step={1}
                        value={p.defaultSellPrice}
                        onChange={(e) => updateProduct(p.id, { defaultSellPrice: toNum(e.target.value) })}
                        placeholder="Ksh"
                      />
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={p.active}
                          onChange={(e) => updateProduct(p.id, { active: e.target.checked })}
                        />
                        Active
                      </label>
                    </td>
                    <td>
                      <button
                        className="text-xs border rounded-lg px-2 py-1"
                        onClick={() => removeProduct(p.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              Set a default selling price. Override per outlet below.
            </p>
          </div>

          {/* Per-outlet overrides */}
          <div className="rounded-xl border p-3">
            <h3 className="font-medium mb-2">Per-Outlet Price Overrides</h3>
            {outlets.length === 0 && (
              <p className="text-sm text-gray-600">Create outlets first.</p>
            )}
            {outlets.map((o) => (
              <div key={o.id} className="mb-4">
                <h4 className="font-semibold mb-1">{o.name}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Product</th>
                        <th>Override Price (Ksh)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products
                        .filter((p) => p.active)
                        .map((p) => (
                          <tr key={p.id} className="border-b">
                            <td className="py-2">{p.name}</td>
                            <td>
                              <input
                                className="border rounded-xl p-2 w-36"
                                type="number"
                                min={0}
                                step={1}
                                value={getOverridePrice(o.id, p.key)}
                                onChange={(e) =>
                                  setOverridePrice(o.id, p.key, toNum(e.target.value))
                                }
                                placeholder={`${p.defaultSellPrice}`}
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-600">
              Attendant dashboard will use the outlet override if set, otherwise the default price.
            </p>
          </div>
        </section>
      )}

      {/* ---------- STAFF & CODES ---------- */}
      {tab === "staff" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Staff & Codes</h2>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addStaff}>
              + Add Staff / Code
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Role</th>
                  <th>Code</th>
                  <th>Outlet</th>
                  <th>Products (assign)</th>
                  <th>Status</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {staff.length === 0 && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={7}>
                      No staff yet. Use “+ Add Staff / Code”.
                    </td>
                  </tr>
                )}
                {staff.map((s) => (
                  <tr key={s.id} className="border-b align-top">
                    <td className="py-2">
                      <input
                        className="border rounded-xl p-2 w-44"
                        value={s.name}
                        onChange={(e) => updateStaff(s.id, { name: e.target.value })}
                        placeholder="Full name"
                      />
                    </td>
                    <td>
                      <select
                        className="border rounded-xl p-2"
                        value={s.role}
                        onChange={(e) => updateStaff(s.id, { role: e.target.value as StaffRole })}
                      >
                        <option value="admin">admin</option>
                        <option value="supervisor">supervisor</option>
                        <option value="supplier">supplier</option>
                        <option value="attendant">attendant</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-40"
                        value={s.code}
                        onChange={(e) => updateStaff(s.id, { code: e.target.value })}
                        placeholder="Login code e.g. BR1234"
                      />
                    </td>
                    <td>
                      <select
                        className="border rounded-xl p-2 w-40"
                        value={s.outletId}
                        onChange={(e) => updateStaff(s.id, { outletId: e.target.value })}
                      >
                        {outlets.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-md">
                        {products
                          .filter((p) => p.active)
                          .map((p) => {
                            const checked = s.productKeys.includes(p.key);
                            return (
                              <label key={p.id} className="inline-flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleStaffProduct(s.id, p.key)}
                                />
                                {p.name}
                              </label>
                            );
                          })}
                      </div>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={s.active}
                          onChange={(e) => updateStaff(s.id, { active: e.target.checked })}
                        />
                        Active
                      </label>
                    </td>
                    <td>
                      <button
                        className="text-xs border rounded-lg px-2 py-1"
                        onClick={() => removeStaff(s.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="text-xs text-gray-600 mt-2">
              Flow: create outlets → create staff/code → assign outlet → assign products. Codes are used by
              role pages (e.g., Attendant Login) to auto-map outlets and allowed products.
            </p>
          </div>
        </section>
      )}

      {/* ---------- SUPPLY (content placeholder only, per your request) ---------- */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Supply (Admin View)</h2>
          <p className="text-sm text-gray-600">
            Admin overview of supply/transfer activity can be added here later (read-only). Supplier editing happens on the Supplier dashboard.
          </p>
        </section>
      )}

      {/* ---------- REPORTS (link only) ---------- */}
      {tab === "reports" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-2">Reports</h2>
          <p className="text-sm text-gray-600 mb-3">
            Open the reports dashboard to view summaries, waste, supply, and modification requests.
          </p>
          <a
            href="/admin/reports"
            className="inline-block border rounded-2xl px-4 py-2 text-sm bg-black text-white"
          >
            Go to Reports
          </a>
        </section>
      )}

      {/* ---------- FIXED EXPENSES ---------- */}
      {tab === "expenses" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Fixed Expenses</h2>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addExpense}>
              + Add expense
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Name</th>
                  <th>Amount (Ksh)</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && (
                  <tr>
                    <td className="py-3 text-gray-500" colSpan={5}>
                      No expenses yet.
                    </td>
                  </tr>
                )}
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="py-2">
                      <input
                        className="border rounded-xl p-2 w-56"
                        value={e.name}
                        onChange={(ev) => updateExpense(e.id, { name: ev.target.value })}
                        placeholder="Expense name"
                      />
                    </td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-36"
                        type="number"
                        min={0}
                        step={1}
                        value={e.amount}
                        onChange={(ev) => updateExpense(e.id, { amount: toNum(ev.target.value) })}
                        placeholder="Ksh"
                      />
                    </td>
                    <td>
                      <select
                        className="border rounded-xl p-2"
                        value={e.frequency}
                        onChange={(ev) =>
                          updateExpense(e.id, {
                            frequency: ev.target.value as FixedExpense["frequency"],
                          })
                        }
                      >
                        <option value="daily">daily</option>
                        <option value="monthly">monthly</option>
                      </select>
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={e.active}
                          onChange={(ev) => updateExpense(e.id, { active: ev.target.checked })}
                        />
                        Active
                      </label>
                    </td>
                    <td>
                      <button
                        className="text-xs border rounded-lg px-2 py-1"
                        onClick={() => removeExpense(e.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">
              These are deducted in analytics; attendants still record daily operational expenses on their page.
            </p>
          </div>
        </section>
      )}

      {/* ---------- BACKUP / RESTORE ---------- */}
      {tab === "data" && <DataTab exportPayload={exportPayload} onImport={importData} />}
    </main>
  );
}

/* =========================================================
   Small Components
   ========================================================= */
function TabBtn(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`px-3 py-2 rounded-2xl text-sm border ${props.active ? "bg-black text-white" : ""}`}
    >
      {props.children}
    </button>
  );
}

function DataTab({ exportPayload, onImport }: { exportPayload: string; onImport: (txt: string) => void }) {
  const [txt, setTxt] = useState("");

  const download = (): void => {
    const blob = new Blob([exportPayload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `admin-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="rounded-2xl border p-4">
      <h2 className="font-semibold mb-3">Backup / Restore</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border p-3">
          <h3 className="font-medium mb-2">Current Settings (read-only)</h3>
          <textarea className="w-full h-64 border rounded-xl p-2 text-xs" readOnly value={exportPayload} />
          <div className="mt-2 flex gap-2">
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={download}>
              Download JSON
            </button>
          </div>
        </div>

        <div className="rounded-xl border p-3">
          <h3 className="font-medium mb-2">Import Settings</h3>
          <textarea
            className="w-full h-64 border rounded-xl p-2 text-xs"
            placeholder="Paste JSON here…"
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
          />
          <div className="mt-2">
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={() => onImport(txt)}>
              Import JSON
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

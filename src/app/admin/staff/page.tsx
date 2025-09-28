"use client";

import React, { useEffect, useMemo, useState } from "react";
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON } from "@/utils/safeStorage";

// ===== Types kept exactly as your original =====
type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";
type Unit = "kg" | "pcs";
type ItemKey =
  | "beef" | "goat" | "liver" | "kuku" | "matumbo"
  | "potatoes" | "samosas" | "mutura";

type Staff = {
  id: string;
  name: string;
  code: string;     // e.g. "MusyokiA"
  outlet: Outlet;   // assigned outlet
  products: ItemKey[]; // what they’re accountable for
  active: boolean;
};

// ===== Storage keys stay the same =====
const ADMIN_STAFF_KEY = "admin_staff";
const SCOPE_KEY = "attendant_scope"; // NEW: mapping attendant_code -> { outlet, productKeys }

const ITEMS: { key: ItemKey; name: string; unit: Unit }[] = [
  { key: "beef", name: "Beef", unit: "kg" },
  { key: "goat", name: "Goat (Cigon)", unit: "kg" },
  { key: "liver", name: "Liver", unit: "kg" },
  { key: "kuku", name: "Kuku (Chicken)", unit: "kg" },
  { key: "matumbo", name: "Matumbo", unit: "kg" },
  { key: "potatoes", name: "Potatoes (raw)", unit: "kg" },
  { key: "samosas", name: "Samosas", unit: "pcs" },
  { key: "mutura", name: "Mutura", unit: "pcs" },
];
const OUTLETS: Outlet[] = ["Bright", "Baraka A", "Baraka B", "Baraka C"];

// ===== Utilities (unchanged + small extras) =====
function uid() { return Math.random().toString(36).slice(2); }
function readStaff(): Staff[] { return safeReadJSON<Staff[]>(ADMIN_STAFF_KEY, []); }
function writeStaff(list: Staff[]) { try { safeWriteJSON(ADMIN_STAFF_KEY, list); } catch {} }

// Scope store: code -> { outlet, productKeys }
type ScopeMap = Record<string, { outlet: Outlet; productKeys: ItemKey[] }>
function readScope(): ScopeMap { return safeReadJSON<ScopeMap>(SCOPE_KEY, {} as any); }
function writeScope(map: ScopeMap) { try { safeWriteJSON(SCOPE_KEY, map); } catch {} }

export default function AdminStaffPage() {
  const [list, setList] = useState<Staff[]>([]);
  const [filterOutlet, setFilterOutlet] = useState<Outlet | "ALL">("ALL");
  const [scope, setScope] = useState<ScopeMap>({}); // NEW

  // Load both stores on mount
  useEffect(() => { setList(readStaff()); setScope(readScope()); }, []);

  // CRUD staff (unchanged)
  const addStaff = () => {
    const s: Staff = { id: uid(), name: "", code: "", outlet: "Bright", products: [], active: true };
    const next = [s, ...list];
    setList(next); writeStaff(next);
  };
  const removeStaff = (id: string) => {
    const next = list.filter(s => s.id !== id);
    setList(next); writeStaff(next);
    // also try to clean scope entry if code exists
    const removed = list.find(s => s.id === id);
    if (removed?.code) {
      const m = { ...scope }; delete m[removed.code]; setScope(m); writeScope(m);
    }
  };
  const update = (id: string, patch: Partial<Staff>) => {
    const next = list.map(s => s.id === id ? { ...s, ...patch } : s);
    setList(next); writeStaff(next);
  };
  const toggleProduct = (s: Staff, key: ItemKey) => {
    const has = s.products.includes(key);
    const products = has ? s.products.filter(k => k !== key) : [...s.products, key];
    update(s.id, { products });
  };

  // Derived view
  const shown = useMemo(() => filterOutlet === "ALL" ? list : list.filter(s => s.outlet === filterOutlet), [filterOutlet, list]);

  // ===== Scope helpers (do not touch login flow) =====
  const applyScope = (s: Staff) => {
    if (!s.code) return alert("Set a login code first.");
    const m = { ...scope, [s.code]: { outlet: s.outlet, productKeys: s.products } };
    setScope(m); writeScope(m);
    alert(`Scope saved for ${s.name || s.code}. Attendant will see only ${s.outlet} and ${s.products.length} products.`);
  };
  const clearScope = (s: Staff) => {
    if (!s.code) return;
    const m = { ...scope }; delete m[s.code]; setScope(m); writeScope(m);
  };
  const isScoped = (code: string) => !!scope[code];

  // Bulk sync (optional convenience)
  const syncAllScopes = () => {
    const m: ScopeMap = { ...scope };
    list.forEach(s => {
      if (s.active && s.code) m[s.code] = { outlet: s.outlet, productKeys: s.products };
    });
    setScope(m); writeScope(m);
    alert("All active staff synced into attendant_scope.");
  };

  return (
    <main className="mobile-container p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-4 mobile-scroll-x">
        <h1 className="text-2xl font-semibold">Admin • Staff & Responsibilities</h1>
        <div className="flex items-center gap-2">
          <select className="input-mobile border rounded-xl p-2 text-sm" value={filterOutlet} onChange={e=>setFilterOutlet(e.target.value as any)}>
            <option value="ALL">All outlets</option>
            {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={addStaff}>+ Add Staff</button>
          {/* NEW: bulk sync */}
          <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" title="Save outlet+products to attendant_scope for all active staff" onClick={syncAllScopes}>
            Sync All Scopes
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {shown.length === 0 ? (
          <div className="text-sm text-gray-600">No staff yet. Click “+ Add Staff”.</div>
        ) : shown.map((s) => (
          <section key={s.id} className="rounded-2xl border p-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <input className="input-mobile border rounded-xl p-2 w-full" value={s.name} onChange={e=>update(s.id, { name: e.target.value })} placeholder="e.g. Musyoki" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Login Code</label>
                <input className="input-mobile border rounded-xl p-2 w-full font-mono" value={s.code} onChange={e=>update(s.id, { code: e.target.value })} placeholder="e.g. MusyokiA" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Outlet</label>
                <select className="input-mobile border rounded-xl p-2 w-full" value={s.outlet} onChange={e=>update(s.id, { outlet: e.target.value as Outlet })}>
                  {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Active</label>
                <select className="input-mobile border rounded-xl p-2 w-full" value={String(s.active)} onChange={e=>update(s.id, { active: e.target.value === "true" })}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium mb-1">Products accountable</div>
              <div className="flex flex-wrap gap-2 mobile-scroll-x">
                {ITEMS.map(it => {
                  const on = s.products.includes(it.key);
                  return (
                    <button key={it.key}
                      onClick={()=>toggleProduct(s, it.key)}
                      className={`btn-mobile px-3 py-1.5 rounded-xl border text-sm ${on ? "bg-black text-white" : "bg-white"}`}>
                      {it.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* NEW: Scope controls (do NOT change login) */}
            <div className="mt-4 flex items-center gap-2 mobile-scroll-x">
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={()=>applyScope(s)}>
                {isScoped(s.code) ? "Update Scope" : "Apply Scope"}
              </button>
              {isScoped(s.code) && (
                <>
                  <span className="text-xs rounded-lg border px-2 py-1">Scoped</span>
                  <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={()=>clearScope(s)}>Clear Scope</button>
                </>
              )}
              <button className="btn-mobile border rounded-xl px-3 py-2 text-sm" onClick={()=>removeStaff(s.id)}>Remove</button>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

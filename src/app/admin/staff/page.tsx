"use client";

import React, { useEffect, useMemo, useState } from "react";

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

const ADMIN_STAFF_KEY = "admin_staff";
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

function uid() { return Math.random().toString(36).slice(2); }
function readStaff(): Staff[] {
  try { const raw = localStorage.getItem(ADMIN_STAFF_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function writeStaff(list: Staff[]) { localStorage.setItem(ADMIN_STAFF_KEY, JSON.stringify(list)); }

export default function AdminStaffPage() {
  const [list, setList] = useState<Staff[]>([]);
  const [filterOutlet, setFilterOutlet] = useState<Outlet | "ALL">("ALL");

  useEffect(() => { setList(readStaff()); }, []);

  const addStaff = () => {
    const s: Staff = { id: uid(), name: "", code: "", outlet: "Bright", products: [], active: true };
    const next = [s, ...list];
    setList(next); writeStaff(next);
  };
  const removeStaff = (id: string) => {
    const next = list.filter(s => s.id !== id);
    setList(next); writeStaff(next);
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

  const shown = useMemo(() => filterOutlet === "ALL" ? list : list.filter(s => s.outlet === filterOutlet), [filterOutlet, list]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Admin • Staff & Responsibilities</h1>
        <div className="flex items-center gap-2">
          <select className="border rounded-xl p-2 text-sm" value={filterOutlet} onChange={e=>setFilterOutlet(e.target.value as any)}>
            <option value="ALL">All outlets</option>
            {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button className="border rounded-xl px-3 py-2 text-sm" onClick={addStaff}>+ Add Staff</button>
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
                <input className="border rounded-xl p-2 w-full" value={s.name} onChange={e=>update(s.id, { name: e.target.value })} placeholder="e.g. Musyoki" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Login Code</label>
                <input className="border rounded-xl p-2 w-full font-mono" value={s.code} onChange={e=>update(s.id, { code: e.target.value })} placeholder="e.g. MusyokiA" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Outlet</label>
                <select className="border rounded-xl p-2 w-full" value={s.outlet} onChange={e=>update(s.id, { outlet: e.target.value as Outlet })}>
                  {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Active</label>
                <select className="border rounded-xl p-2 w-full" value={String(s.active)} onChange={e=>update(s.id, { active: e.target.value === "true" })}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium mb-1">Products accountable</div>
              <div className="flex flex-wrap gap-2">
                {ITEMS.map(it => {
                  const on = s.products.includes(it.key);
                  return (
                    <button key={it.key}
                      onClick={()=>toggleProduct(s, it.key)}
                      className={`px-3 py-1.5 rounded-xl border text-sm ${on ? "bg-black text-white" : "bg-white"}`}>
                      {it.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="border rounded-xl px-3 py-2 text-sm" onClick={()=>removeStaff(s.id)}>Remove</button>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

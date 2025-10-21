"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { readJSON as safeReadJSON, writeJSON as safeWriteJSON } from "@/utils/safeStorage";

import { canonFull } from "@/lib/codeNormalize";
import { notifyToast, registerAdminToast } from '@/lib/toast';

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
const STAFF_REMOTE_KEY = "admin_staff";
const SCOPE_REMOTE_KEY = "attendant_scope";

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
type ScopeValue = { outlet: Outlet; productKeys: ItemKey[] };
type ScopeMap = Record<string, ScopeValue>;

function normalizeScope(map: Record<string, { outlet?: string; productKeys?: ItemKey[] }> | null | undefined): ScopeMap {
  const clean: ScopeMap = {};
  if (!map) return clean;
  for (const [key, value] of Object.entries(map)) {
    const canonical = canonFull(key);
    if (!canonical) continue;
    const rawOutlet = (value?.outlet || "") as string;
    const outlet = (OUTLETS as readonly string[]).includes(rawOutlet as Outlet) ? (rawOutlet as Outlet) : OUTLETS[0];
    const productKeys = Array.isArray(value?.productKeys)
      ? (value.productKeys.filter((k: any) => ITEMS.some(item => item.key === k)) as ItemKey[])
      : [];
    clean[canonical] = { outlet, productKeys };
  }
  return clean;
}

function readScope(): ScopeMap {
  const raw = safeReadJSON<Record<string, { outlet?: string; productKeys?: ItemKey[] }>>(SCOPE_KEY, {} as any);
  return normalizeScope(raw);
}
function writeScope(map: ScopeMap) { try { safeWriteJSON(SCOPE_KEY, map); } catch {} }

export default function AdminStaffPage() {
  const [list, setList] = useState<Staff[]>([]);
  const [filterOutlet, setFilterOutlet] = useState<Outlet | "ALL">("ALL");
  const [scope, setScope] = useState<ScopeMap>({}); // NEW
  // Commission config cache keyed by canonical code
  const [commissionByCode, setCommissionByCode] = useState<Record<string, { targetKg: number; ratePerKg: number; loading?: boolean }>>({});

  const fetchSetting = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/api/settings/${key}`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      return json?.value ?? null;
    } catch (err) {
      console.error("failed to fetch setting", key, err);
      return null;
    }
  }, []);

  const persistStaffToServer = useCallback(async (next: Staff[]) => {
    try {
      await fetch(`/api/settings/${STAFF_REMOTE_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ value: next }),
      });
    } catch (err) {
      console.error("persist staff failed", err);
    }
  }, []);

  const persistScopeSetting = useCallback(async (next: ScopeMap) => {
    try {
      await fetch(`/api/settings/${SCOPE_REMOTE_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ value: next }),
      });
    } catch (err) {
      console.error("persist scope failed", err);
    }
  }, []);

  // Load both stores on mount
  useEffect(() => {
    (async () => {
      const remoteStaff = await fetchSetting(STAFF_REMOTE_KEY);
      if (Array.isArray(remoteStaff)) {
        const hydrated = remoteStaff as Staff[];
        setList(hydrated);
        writeStaff(hydrated);
      } else {
        const local = readStaff();
        setList(local);
        if (local.length) {
          await persistStaffToServer(local);
        }
      }

      const remoteScope = await fetchSetting(SCOPE_REMOTE_KEY);
      if (remoteScope && typeof remoteScope === 'object') {
        const normalized = normalizeScope(remoteScope as Record<string, { outlet?: string; productKeys?: ItemKey[] }>);
        setScope(normalized);
        writeScope(normalized);
      } else {
        const localScope = readScope();
        setScope(localScope);
        if (Object.keys(localScope).length) {
          await persistScopeSetting(localScope);
        }
      }
    })();
  }, [fetchSetting, persistScopeSetting, persistStaffToServer]);

  useEffect(() => { try { registerAdminToast((m) => notifyToast(m)); } catch {} ; return () => { try { registerAdminToast(null); } catch {} } }, []);

  // CRUD staff (unchanged)
  const addStaff = () => {
    const s: Staff = { id: uid(), name: "", code: "", outlet: "Bright", products: [], active: true };
    const next = [s, ...list];
    setList(next); writeStaff(next);
    persistStaffToServer(next);
  };
  const removeStaff = (id: string) => {
    const next = list.filter(s => s.id !== id);
    setList(next); writeStaff(next);
    persistStaffToServer(next);
    // also try to clean scope entry if code exists
    const removed = list.find(s => s.id === id);
    if (removed?.code) {
      const canonical = canonFull(removed.code);
      if (canonical) {
        const m = { ...scope }; delete m[canonical]; setScope(m); writeScope(m); persistScopeSetting(m);
      }
    }
  };
  const update = (id: string, patch: Partial<Staff>) => {
    const next = list.map(s => s.id === id ? { ...s, ...patch } : s);
    setList(next); writeStaff(next);
    persistStaffToServer(next);
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
    const canonical = canonFull(s.code);
  if (!canonical) return notifyToast("Set a login code first.");
    const scopeValue: ScopeValue = { outlet: s.outlet, productKeys: s.products };
    const next = { ...scope, [canonical]: scopeValue };
    setScope(next); writeScope(next); persistScopeSetting(next);
    // Write-through to server (best-effort)
    (async () => {
      try {
        const scopeRes = await fetch(`/api/admin/scope/${encodeURIComponent(canonical)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ outlet: scopeValue.outlet, productKeys: scopeValue.productKeys }),
        });
        if (!scopeRes.ok) throw new Error(await scopeRes.text());

        const payload = {
          people: [{
            role: 'attendant',
            code: canonical,
            name: s.name || s.code || canonical,
            outlet: s.outlet,
            productKeys: s.products,
            active: s.active,
          }],
        };
        const attendantRes = await fetch('/api/admin/attendants/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(payload),
        });
        if (!attendantRes.ok) throw new Error(await attendantRes.text());

  // non-blocking toast feedback
  try { notifyToast('Scope saved for ' + (s.name || s.code) + ' ✅'); } catch {}
        } catch (err) {
        console.error(err);
        try { notifyToast('Saved locally, but failed to sync scope/login for ' + (s.name || s.code)); } catch {}
      }
    })();
  };
  const clearScope = (s: Staff) => {
    const canonical = canonFull(s.code);
    if (!canonical) return;
    const m = { ...scope }; delete m[canonical]; setScope(m); writeScope(m);
    // Mirror clear to server
    (async () => {
      try {
        const url = new URL("/api/admin/scope", window.location.origin);
        url.searchParams.set("code", canonical);
        const res = await fetch(url.toString(), { method: "DELETE", cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
      } catch {
        // non-blocking
      }
    })();
  };
  const isScoped = (code: string) => {
    const canonical = canonFull(code);
    return !!(canonical && scope[canonical]);
  };

  // ===== Commission config helpers =====
  async function loadCommission(code: string) {
    const canonical = canonFull(code); if (!canonical) return;
    setCommissionByCode((m) => ({ ...m, [canonical]: { ...(m[canonical] || { targetKg: 25, ratePerKg: 50 }), loading: true } }));
    try {
      const url = new URL("/api/admin/commission-config", window.location.origin);
      url.searchParams.set("code", canonical);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const cfg = json?.config || null;
      const targetKg = Number(cfg?.targetKg ?? 25);
      const ratePerKg = Number(cfg?.ratePerKg ?? 50);
      setCommissionByCode((m) => ({ ...m, [canonical]: { targetKg, ratePerKg, loading: false } }));
    } catch {
      setCommissionByCode((m) => ({ ...m, [canonical]: { ...(m[canonical] || { targetKg: 25, ratePerKg: 50 }), loading: false } }));
    }
  }
  async function saveCommission(code: string) {
    const canonical = canonFull(code); if (!canonical) return;
    const cur = commissionByCode[canonical] || { targetKg: 25, ratePerKg: 50 };
    setCommissionByCode((m) => ({ ...m, [canonical]: { ...cur, loading: true } }));
    try {
      const res = await fetch("/api/admin/commission-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-auth": "true" },
        cache: "no-store",
        body: JSON.stringify({ code: canonical, targetKg: cur.targetKg, ratePerKg: cur.ratePerKg, isActive: true }),
      });
      const ok = res.ok;
      if (!ok) throw new Error(await res.text());
    setCommissionByCode((m) => ({ ...m, [canonical]: { ...cur, loading: false } }));
  notifyToast("Commission settings saved ✅");
    } catch (e) {
      console.error(e);
    setCommissionByCode((m) => ({ ...m, [canonical]: { ...cur, loading: false } }));
  notifyToast("Failed to save commission settings");
    }
  }

  // Bulk sync (optional convenience)
  const syncAllScopes = () => {
    const payload: ScopeMap = {};
    const people: Array<{ role: "attendant"; code: string; name: string; outlet: Outlet; productKeys: ItemKey[]; active: boolean }> = [];

    list.forEach((s) => {
      const canonical = canonFull(s.code);
      if (!canonical) return;
      const scopeValue: ScopeValue = { outlet: s.outlet, productKeys: s.products };
      if (s.active) {
        payload[canonical] = scopeValue;
      }
      people.push({
        role: "attendant",
        code: canonical,
        name: s.name || s.code || canonical,
        outlet: s.outlet,
        productKeys: s.products,
        active: s.active,
      });
    });

    setScope(payload);
    writeScope(payload);
    persistScopeSetting(payload);
    // Push entire map to server (best-effort)
    (async () => {
      try {
        const requests: Promise<Response>[] = [
          fetch('/api/admin/scope', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify(payload),
          }),
        ];
        if (people.length) {
          requests.push(
            fetch("/api/admin/attendants/upsert", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({ people }),
            })
          );
        }
        const responses = await Promise.all(requests);
        const scopeRes = responses[0];
        if (!scopeRes.ok) throw new Error(await scopeRes.text());
        if (people.length) {
          const attendantRes = responses[1];
          if (!attendantRes.ok) throw new Error(await attendantRes.text());
        }
  notifyToast("All active staff scopes synced to server ✅");
      } catch (err) {
        console.error(err);
  notifyToast("Scopes saved locally, but failed to sync all to server.");
      }
    })();
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

            {/* Commission settings */}
            <div className="mt-4 p-3 rounded-xl border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">Commission Settings</div>
                <div className="flex items-center gap-2">
                  <button className="btn-mobile border rounded-xl px-2 py-1 text-xs" onClick={()=>loadCommission(s.code)}>Load</button>
                  <button className="btn-mobile border rounded-xl px-2 py-1 text-xs" onClick={()=>saveCommission(s.code)}>Save</button>
                </div>
              </div>
              {(() => {
                const canonical = canonFull(s.code);
                const cur = (canonical && commissionByCode[canonical]) || { targetKg: 25, ratePerKg: 50 };
                return (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Daily target (kg)</label>
                      <input type="number" min={0} step={0.1} className="input-mobile border rounded-xl p-2 w-full"
                        value={cur.targetKg}
                        onChange={(e)=>{
                          const v = Number(e.target.value || 0);
                          if (!canonical) return;
                          setCommissionByCode(m => ({ ...m, [canonical]: { ...(m[canonical] || { ratePerKg: 50 }), targetKg: v } }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Rate per kg (Ksh)</label>
                      <input type="number" min={0} step={1} className="input-mobile border rounded-xl p-2 w-full"
                        value={cur.ratePerKg}
                        onChange={(e)=>{
                          const v = Number(e.target.value || 0);
                          if (!canonical) return;
                          setCommissionByCode(m => ({ ...m, [canonical]: { ...(m[canonical] || { targetKg: 25 }), ratePerKg: v } }));
                        }}
                      />
                    </div>
                    <div className="flex items-end">
                      <span className="text-xs text-gray-500">{cur.loading ? 'Loading…' : ' '}</span>
                    </div>
                  </div>
                );
              })()}
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

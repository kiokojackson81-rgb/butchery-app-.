"use client";
import React, { useEffect, useState } from "react";
import AdminGuard from "@/components/guards/AdminGuard";
import { canonFull } from "@/lib/codeNormalize";

type Row = { code: string };

type AssistantDetail = { code: string; outlet?: string | null; products?: string[] };

async function getList(details = false): Promise<AssistantDetail[]> {
  // Prefer enriched admin endpoint (includes outlet + products if details=true)
  const url = details ? "/api/admin/assistants?details=1" : "/api/admin/assistants";
  const headers: any = {};
  try { const { getAdminAuth } = await import("@/lib/auth/clientState"); if (getAdminAuth()) headers['x-admin-auth'] = 'true'; } catch { if (typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true') headers['x-admin-auth'] = 'true'; }
  const r = await fetch(url, { cache: 'no-store', headers });
  if (!r.ok) return [];
  const j = await r.json();
  const base = Array.isArray(j?.list) ? j.list : [];
  // If details were returned
  if (Array.isArray(j?.details)) return j.details as AssistantDetail[];
  return base.map((c: any) => ({ code: String(c) }));
}

async function addCode(code: string) {
  const headers: any = { "Content-Type": "application/json" };
  try {
    const { getAdminAuth } = await import("@/lib/auth/clientState");
    if (getAdminAuth()) headers["x-admin-auth"] = "true";
  } catch { if (typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true') headers['x-admin-auth'] = 'true'; }
  const r = await fetch("/api/admin/assistants", { method: "POST", headers, body: JSON.stringify({ action: "add", code }) });
  return r.json();
}

async function removeCode(code: string) {
  const headers: any = { "Content-Type": "application/json" };
  try {
    const { getAdminAuth } = await import("@/lib/auth/clientState");
    if (getAdminAuth()) headers["x-admin-auth"] = "true";
  } catch { if (typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true') headers['x-admin-auth'] = 'true'; }
  const r = await fetch("/api/admin/assistants", { method: "POST", headers, body: JSON.stringify({ action: "remove", code }) });
  return r.json();
}

export default function AssistantsSettingsPage() {
  const [rows, setRows] = useState<AssistantDetail[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
  const list = await getList(true);
  setRows(list);
      } catch (e: any) {
        setError(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onAdd() {
    const raw = input.trim();
    if (!raw) return;
  const code = canonFull(raw).toUpperCase();
    const j = await addCode(code);
    if (!j?.ok) { setError(j?.error || "Add failed"); return; }
    setRows((prev) => {
      if (prev.some((r) => r.code === code)) return prev;
      return [{ code }, ...prev];
    });
    setInput("");
  }

  async function onRemove(code: string) {
    const j = await removeCode(code);
    if (!j?.ok) { setError(j?.error || "Remove failed"); return; }
  setRows((prev) => prev.filter((r) => r.code !== code));
  }

  return (
    <AdminGuard>
      <main className="p-6">
        <h1 className="text-2xl font-bold">Assistant Attendants</h1>
        <p className="text-sm text-gray-600 mt-1">Assistants deposit to GENERAL till, don’t see Till Sales, and only see their assigned products.</p>

        <div className="mt-4 rounded-2xl border p-4">
          <div className="flex items-center gap-2">
            <input
              className="border rounded-xl p-2 text-sm w-60"
              placeholder="Enter attendant code"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="px-3 py-2 rounded-xl border" onClick={onAdd}>Add</button>
          </div>
          {error && (
            <div className="mt-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="mt-4 table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Code</th>
                <th>Outlet</th>
                <th>Products</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="py-2 text-gray-500" colSpan={4}>Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td className="py-2 text-gray-500" colSpan={4}>No assistants yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.code} className="border-b">
                  <td className="py-2 font-mono">{r.code}</td>
                  <td className="py-2">{r.outlet || '—'}</td>
                  <td className="py-2">{Array.isArray(r.products) && r.products.length > 0 ? r.products.join(', ') : '—'}</td>
                  <td className="text-right">
                    <button className="text-xs border rounded-lg px-2 py-1" onClick={() => onRemove(r.code)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </AdminGuard>
  );
}

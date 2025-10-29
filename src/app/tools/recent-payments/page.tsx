"use client";
import React, { useEffect, useMemo, useState } from "react";

// Minimal public helper page to view recent payments using an admin API key header.
// Notes:
// - Stores the key in sessionStorage under 'x_admin_key' (NOT mirrored by StorageBridge).
// - Calls GET /api/admin/payments/recent with header 'x-admin-key'.
// - Renders a compact table and raw JSON for debugging.

type RecentItem = {
  id: string;
  createdAt: string;
  outlet: string | null;
  amount: number | null;
  status: string | null;
  receipt: string | null;
  businessShortCode: string | null;
  accountReference: string | null;
  msisdnMasked: string | null;
};

export default function RecentPaymentsTool() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RecentItem[]>([]);
  const [raw, setRaw] = useState<any>(null);

  // hydrate key from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("x_admin_key");
      if (saved) setKey(saved);
    } catch {}
  }, []);

  async function fetchRecent(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    setItems([]);
    setRaw(null);
    try {
      // Persist to session for later page visits (not mirrored server-side)
      try { sessionStorage.setItem("x_admin_key", key); } catch {}
      const res = await fetch("/api/admin/payments/recent", {
        method: "GET",
        headers: { "x-admin-key": key },
        cache: "no-store",
      });
      const j = await res.json().catch(() => null as any);
      setRaw(j);
      if (!res.ok || !j?.ok) {
        setError(j?.error || `HTTP ${res.status}`);
        return;
      }
      setItems((j?.data?.items || []) as RecentItem[]);
    } catch (e: any) {
      setError(e?.message || "request failed");
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch on load if key is present, and refresh periodically
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // initial fetch
    fetchRecent().catch(() => {});
    // poll every 15s
    const id = setInterval(() => {
      if (!cancelled) fetchRecent().catch(() => {});
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  const hasItems = items && items.length > 0;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-3">Recent Payments (admin key)</h1>
      <form onSubmit={fetchRecent} className="flex gap-2 mb-4">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste ADMIN_API_KEY"
          className="border rounded px-3 py-2 flex-1"
          type="password"
          autoComplete="off"
        />
        <button className="bg-black text-white px-4 py-2 rounded disabled:opacity-60" disabled={loading || !key}>
          {loading ? "Loading..." : "Fetch"}
        </button>
      </form>

      {error && (
        <div className="border border-red-300 text-red-700 bg-red-50 rounded p-3 mb-4">{error}</div>
      )}

      {hasItems ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 border-b">Date</th>
                <th className="text-left p-2 border-b">Outlet</th>
                <th className="text-left p-2 border-b">Till/HO</th>
                <th className="text-right p-2 border-b">Amount</th>
                <th className="text-left p-2 border-b">Phone (masked)</th>
                <th className="text-left p-2 border-b">Receipt</th>
                <th className="text-left p-2 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 border-b">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-2 border-b">{r.outlet ?? "-"}</td>
                  <td className="p-2 border-b">{r.businessShortCode ?? "-"}</td>
                  <td className="p-2 border-b text-right">{r.amount ?? "-"}</td>
                  <td className="p-2 border-b">{r.msisdnMasked ?? "-"}</td>
                  <td className="p-2 border-b">{r.receipt ?? "-"}</td>
                  <td className="p-2 border-b">{r.status ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-gray-600 mb-4">No items yet. Paste your key and click Fetch.</div>
      )}

      <details className="mt-6">
        <summary className="cursor-pointer select-none text-sm text-gray-600">Raw response</summary>
        <pre className="bg-gray-100 rounded p-3 text-xs overflow-auto mt-2">{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}

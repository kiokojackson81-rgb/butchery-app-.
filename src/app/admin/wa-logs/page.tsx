"use client";
import { useEffect, useMemo, useState } from "react";

type Log = {
  id: string;
  createdAt: string;
  direction: "in" | "out";
  templateName: string | null;
  status: string | null;
  waMessageId: string | null;
  payload: any;
};

export default function WALogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(50);
  const [sinceMin, setSinceMin] = useState(1440);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (phone) params.set("phone", phone);
      if (direction) params.set("direction", direction);
      if (status) params.set("status", status);
      if (limit) params.set("limit", String(limit));
      if (sinceMin) params.set("sinceMin", String(sinceMin));
      const res = await fetch(`/api/admin/wa-logs?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "Failed");
      setLogs(j.logs || []);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => logs.map((l) => ({
    id: l.id,
    ts: new Date(l.createdAt).toLocaleString(),
    dir: l.direction,
    status: l.status || "",
    tmpl: l.templateName || "",
    phone: l?.payload?.meta?.phoneE164 || "",
    preview: (() => {
      if (l.payload?.via === "dry-run") {
        if (l.payload?.text) return String(l.payload.text).slice(0, 120);
        if (l.payload?.body) return JSON.stringify(l.payload.body).slice(0, 120);
      }
      if (l.payload?.request) return JSON.stringify(l.payload.request).slice(0, 120);
      return JSON.stringify(l.payload).slice(0, 120);
    })(),
  })), [logs]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">WhatsApp Logs</h1>
      <div className="flex gap-2 flex-wrap items-end">
        <div className="flex flex-col">
          <label className="text-xs">Phone (+E164)</label>
          <input className="border rounded px-2 py-1" placeholder="+2547…" value={phone} onChange={(e)=>setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Direction</label>
          <select className="border rounded px-2 py-1" value={direction} onChange={(e)=>setDirection(e.target.value)}>
            <option value="">Any</option>
            <option value="out">out</option>
            <option value="in">in</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Status</label>
          <input className="border rounded px-2 py-1" placeholder="SENT/ERROR/DELIVERED" value={status} onChange={(e)=>setStatus(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Limit</label>
          <input className="border rounded px-2 py-1 w-24" type="number" value={limit} onChange={(e)=>setLimit(Math.max(1, Math.min(200, Number(e.target.value)||50)))} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Since (min)</label>
          <input className="border rounded px-2 py-1 w-28" type="number" value={sinceMin} onChange={(e)=>setSinceMin(Math.max(1, Math.min(10080, Number(e.target.value)||1440)))} />
        </div>
        <button className="border rounded px-3 py-1" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Time</th>
              <th className="p-2">Dir</th>
              <th className="p-2">Status</th>
              <th className="p-2">Template</th>
              <th className="p-2">Phone</th>
              <th className="p-2">Preview</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{r.ts}</td>
                <td className="p-2">{r.dir}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{r.tmpl}</td>
                <td className="p-2 whitespace-nowrap">{r.phone}</td>
                <td className="p-2 font-mono text-xs">{r.preview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

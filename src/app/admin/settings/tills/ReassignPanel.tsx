"use client";
import React, { useState } from "react";

export default function ReassignPanel() {
  const [receipt, setReceipt] = useState("");
  const [outlet, setOutlet] = useState("BARAKA_B");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSeed() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/tills/seed", { method: "GET", cache: "no-store" });
      const j = await res.json();
      if (j?.ok) setMsg(`Seeded/updated tills (${j.updated ?? ""}). Refreshing...`);
      else setMsg(`Seed failed: ${j?.error || res.status}`);
      setTimeout(()=> window.location.reload(), 600);
    } catch (e:any) { setMsg(String(e)); } finally { setBusy(false); }
  }

  async function reassign() {
    if (!receipt || !outlet) { setMsg("Enter receipt and outlet code"); return; }
    setBusy(true); setMsg(null);
    try {
      const headers: any = { "content-type": "application/json" };
      try {
        const isAdmin = typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true';
        if (isAdmin) headers['x-admin-auth'] = 'true';
      } catch {}
      const res = await fetch('/api/admin/payments/reassign', { method: 'POST', headers, body: JSON.stringify({ receipt, outletCode: outlet }) });
      const j = await res.json();
      if (j?.ok) setMsg(`Reassigned ${j.payment?.mpesaReceipt || receipt} → ${j.payment?.outletCode || outlet}`);
      else setMsg(`Reassign failed: ${j?.error || res.status}`);
    } catch (e:any) { setMsg(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="p-4 border rounded space-y-3">
      <h3 className="font-semibold">Tools</h3>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm">Receipt</label>
          <input value={receipt} onChange={e=>setReceipt(e.target.value)} placeholder="TJS3K8N..." className="border p-2 w-full text-black" />
        </div>
        <div>
          <label className="block text-sm">Outlet code</label>
          <input value={outlet} onChange={e=>setOutlet(e.target.value.toUpperCase())} placeholder="BARAKA_B" className="border p-2 text-black" />
        </div>
        <button disabled={busy} onClick={reassign} className="bg-amber-600 text-white px-3 py-2 rounded">Reassign</button>
      </div>
      <div className="flex gap-2 items-center">
        <button disabled={busy} onClick={runSeed} className="bg-blue-600 text-white px-3 py-2 rounded">Apply swap (seed)</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <p className="text-xs opacity-70">Admin session required. Open Admin → Login if actions are forbidden.</p>
    </div>
  );
}

"use client";
import { useState } from "react";

export default function WaTestPage() {
  const [to, setTo] = useState("");
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState("");
  const [resp, setResp] = useState<any>(null);
  const [err, setErr] = useState("");

  const send = async () => {
    setErr(""); setResp(null);
    try {
      const r = await fetch("/api/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ to, template, params: params.split("|").map(s=>s.trim()).filter(Boolean) }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed");
      setResp(j);
    } catch (e: any) { setErr(e?.message || "Error"); }
  };

  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">WhatsApp Test</h1>
      <div className="rounded-2xl border p-4 space-y-3">
        <input className="border rounded-xl p-2 w-full" placeholder="Phone E.164 (e.g. +2547xxxxxxx)" value={to} onChange={e=>setTo(e.target.value)} />
        <input className="border rounded-xl p-2 w-full" placeholder="Template name" value={template} onChange={e=>setTemplate(e.target.value)} />
        <input className="border rounded-xl p-2 w-full" placeholder="Params (Ian|Beef|10|Kyalo)" value={params} onChange={e=>setParams(e.target.value)} />
        <button className="px-4 py-2 rounded-xl border" onClick={send}>Send</button>
        {err && <div className="text-sm text-red-600">{err}</div>}
        {resp && <pre className="text-xs bg-neutral-900 text-neutral-100 rounded-xl p-3 overflow-auto">{JSON.stringify(resp, null, 2)}</pre>}
      </div>
    </main>
  );
}

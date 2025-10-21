"use client";
import { useEffect, useMemo, useState } from "react";
import { notifyToast, registerAdminToast } from '@/lib/toast';

type Log = {
  id: string;
  createdAt: string;
  direction: "in" | "out";
  templateName: string | null;
  status: string | null;
  type?: string | null;
  waMessageId: string | null;
  payload: any;
};

export default function WALogsPage() {
  // Local helper to use admin toast if available
  // Register centralized toast setter
  useEffect(() => { try { registerAdminToast((m) => notifyToast(m)); } catch {} ; return () => { try { registerAdminToast(null); } catch {} } }, []);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(50);
  const [sinceMin, setSinceMin] = useState(1440);
  const [sendTo, setSendTo] = useState("");
  const [sendText, setSendText] = useState("");
  const [sendTemplate, setSendTemplate] = useState("");
  const [sendParams, setSendParams] = useState("");
  const [sending, setSending] = useState(false);
  // Diagnostics inspector state
  const [diagPhone, setDiagPhone] = useState("");
  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagAction, setDiagAction] = useState<"text"|"template"|"interactive"|"gpt_dryrun">("text");
  const [diagText, setDiagText] = useState("");
  const [diagTemplate, setDiagTemplate] = useState("");
  const [diagParams, setDiagParams] = useState("");

  // Flow configuration state
  const [attendantCfg, setAttendantCfg] = useState<any | null>(null);
  const [supplierCfg, setSupplierCfg] = useState<any | null>(null);
  const [supervisorCfg, setSupervisorCfg] = useState<any | null>(null);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [showGptOnly, setShowGptOnly] = useState(false);

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

  async function loadConfig() {
    setCfgLoading(true);
    try {
      const [a, s, v] = await Promise.all([
        fetch("/api/settings/wa_flow_attendant", { cache: "no-store" }).then(r=>r.json()).catch(()=>({ value: null })),
        fetch("/api/settings/wa_flow_supplier", { cache: "no-store" }).then(r=>r.json()).catch(()=>({ value: null })),
        fetch("/api/settings/wa_flow_supervisor", { cache: "no-store" }).then(r=>r.json()).catch(()=>({ value: null })),
      ]);
      setAttendantCfg(a?.value ?? {
        enableExpense: true, enableDeposit: true, enableTxns: true,
        enableSupplyView: true, enableSummary: true, enableSubmitAndLock: true, enableWaste: true,
      });
      setSupplierCfg(s?.value ?? { enableTransfer: true, enableRecent: true, enableDisputes: true });
      setSupervisorCfg(v?.value ?? { showReview: true, showTxns: true, showLogout: true });
    } finally {
      setCfgLoading(false);
    }
  }

  useEffect(() => { loadConfig(); }, []);

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

  const gptRows = useMemo(() => logs.filter((l) => {
    try {
      const meta = l.payload?.meta || (typeof l.payload === 'object' ? l.payload : null);
      if (meta && (meta.gpt_sent === true || (meta._type && String(meta._type).startsWith('AI_DISPATCH')))) return true;
    } catch {}
    if (String(l.type || '').startsWith('AI_DISPATCH')) return true;
    return false;
  }), [logs]);

  const oocRows = useMemo(() => logs.filter((l) => l.type === 'OOC_INVALID' || l.type === 'OOC_INFO'), [logs]);

  return (
    <div className="p-4 space-y-4 bg-slate-900 text-slate-100 min-h-screen">
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

      {/* Diagnostics inspector */}
      <div className="rounded border border-slate-700 p-3 bg-slate-900">
        <h2 className="font-medium mb-2">WhatsApp Diagnostics Inspector</h2>
        <div className="flex gap-2 flex-wrap items-end mb-3">
          <div className="flex flex-col">
            <label className="text-xs">Phone (+E164)</label>
            <input className="border rounded px-2 py-1 w-56" placeholder="+2547…" value={diagPhone} onChange={(e)=>setDiagPhone(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Action</label>
            <select className="border rounded px-2 py-1" value={diagAction} onChange={(e)=>setDiagAction(e.target.value as any)}>
              <option value="text">Text (safe)</option>
              <option value="template">Template (safe)</option>
              <option value="interactive">Interactive (safe)</option>
              <option value="gpt_dryrun">GPT dry-run (no send)</option>
            </select>
          </div>
          <div className="flex-1 min-w-[280px]">
            <label className="text-xs">Text</label>
            <input className="border rounded px-2 py-1 w-full bg-slate-800 text-slate-100 border-slate-700" value={diagText} onChange={(e)=>setDiagText(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Template</label>
            <input className="border rounded px-2 py-1 w-56 bg-slate-800 text-slate-100 border-slate-700" value={diagTemplate} onChange={(e)=>setDiagTemplate(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Params (comma)</label>
            <input className="border rounded px-2 py-1 w-56 bg-slate-800 text-slate-100 border-slate-700" value={diagParams} onChange={(e)=>setDiagParams(e.target.value)} />
          </div>
          <button
            className="border rounded px-3 py-1 bg-slate-700 text-slate-100 border-slate-600"
            disabled={!diagPhone || diagLoading}
            onClick={async ()=>{
              try {
                setDiagLoading(true);
                setDiagResult(null);
                const to = diagPhone.startsWith("+") ? diagPhone : `+${diagPhone}`;
                const body: any = { phone: to, action: diagAction };
                if (diagAction === "text") body.text = diagText || "Test message from admin";
                if (diagAction === "template") { body.template = diagTemplate; body.params = diagParams ? diagParams.split(",").map(s=>s.trim()) : []; }
                if (diagAction === "interactive") { body.interactive = { type: "button", body: diagText || "Hello" }; }
                const res = await fetch(`/api/wa/admin/inspect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                const j = await res.json().catch(()=>null);
                setDiagResult({ status: res.status, body: j });
                await load();
              } catch (e:any) {
                setDiagResult({ error: String(e?.message || e) });
              } finally {
                setDiagLoading(false);
              }
            }}
          >{diagLoading ? "Running…" : "Run"}</button>
          <button className="border rounded px-3 py-1 bg-slate-700 text-slate-100 border-slate-600" onClick={async ()=>{
            if (!diagPhone) return; setDiagLoading(true); setDiagResult(null);
            try {
              const url = `/api/wa/admin/inspect?phone=${encodeURIComponent(diagPhone)}`;
              const r = await fetch(url, { cache: "no-store" });
              const j = await r.json().catch(()=>null);
              setDiagResult({ status: r.status, body: j });
            } catch (e:any) { setDiagResult({ error: String(e?.message || e) }); }
            finally { setDiagLoading(false); }
          }}>Fetch</button>
        </div>
        <div className="text-xs text-slate-400 mb-2">Result:</div>
        <pre className="bg-slate-800 p-2 rounded text-xs text-slate-200 max-h-64 overflow-auto">{diagResult ? JSON.stringify(diagResult, null, 2) : "No result"}</pre>
      </div>

      {/* GPT Debug summary */}
      <div className="rounded border border-slate-700 p-3 bg-slate-900">
        <h2 className="font-medium mb-2">GPT Debug</h2>
        <div className="flex items-center gap-4 mb-3">
          <div className="text-sm">GPT-origin rows: <strong>{gptRows.length}</strong></div>
          <div className="text-sm">OOC issues: <strong>{oocRows.length}</strong></div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showGptOnly} onChange={(e)=>setShowGptOnly(e.target.checked)} />
            Show only GPT-origin
          </label>
          <button className="border rounded px-2 py-1 text-sm" onClick={async ()=>{ await load(); }}>Refresh logs</button>
        </div>

  <div className="mb-2 text-xs text-slate-400">Quick view (click a row to show raw)</div>
        <div className="max-h-48 overflow-auto border border-slate-700 rounded">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left bg-slate-800">
                <th className="p-1">Time</th>
                <th className="p-1">Dir</th>
                <th className="p-1">Type</th>
                <th className="p-1">Phone</th>
                <th className="p-1">Short</th>
              </tr>
            </thead>
            <tbody>
              {(showGptOnly ? gptRows : logs).slice(0, 50).map((l)=> (
                <tr key={l.id} className="border-t hover:bg-slate-800 cursor-pointer" onClick={()=>setDiagResult(l)}>
                  <td className="p-1 align-top">{new Date(l.createdAt).toLocaleTimeString()}</td>
                  <td className="p-1 align-top">{l.direction}</td>
                  <td className="p-1 align-top">{l.type || l.templateName || ''}</td>
                  <td className="p-1 align-top">{l.payload?.meta?.phoneE164 || ''}</td>
                  <td className="p-1 align-top font-mono truncate">{String(l.payload && (l.payload.text || l.payload.request || JSON.stringify(l.payload)).slice ? (l.payload.text || JSON.stringify(l.payload.request) || JSON.stringify(l.payload)).slice(0, 80) : JSON.stringify(l.payload)).slice(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <button className="border rounded px-2 py-1 text-sm" onClick={async ()=>{
              if (!diagResult) return notifyToast('Select a row first');
              // If selected row is inbound, attempt to extract text for GPT dry-run
              let text = '';
              try {
                const p = diagResult.payload;
                if (p?.text?.body) text = p.text.body;
                else if (p?.interactive?.list_reply?.title) text = p.interactive.list_reply.title;
                else if (p?.interactive?.button_reply?.title) text = p.interactive.button_reply.title;
              } catch {}
              const phone = diagResult.payload?.from || diagResult.payload?.meta?.phoneE164 || diagResult.payload?.phone || '';
              if (!phone) return notifyToast('Cannot determine phone from selected row');
              const ok = confirm(`Re-run GPT dry-run for ${phone} using text: "${text || '<empty>'}"?`);
              if (!ok) return;
              try {
                setDiagLoading(true);
                const res = await fetch('/api/wa/admin/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, kind: 'gpt', text }) });
                const j = await res.json().catch(()=>null);
                setDiagResult({ status: res.status, body: j });
              } catch (e:any) { setDiagResult({ error: String(e?.message || e) }); }
              finally { setDiagLoading(false); }
            }}>Re-run GPT dry-run for selected</button>
            <button className="border rounded px-2 py-1 text-sm" onClick={async ()=>{ if (!diagResult) return notifyToast('Select a row first'); setDiagResult(diagResult); }}>Show raw</button>
          </div>
        </div>
      </div>

      {/* Sender controls */}
      <div className="rounded border border-slate-700 p-3 bg-slate-900">
        <h2 className="font-medium mb-2">Send WhatsApp Message</h2>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex flex-col">
            <label className="text-xs">To (+E164)</label>
            <input className="border rounded px-2 py-1 w-56 bg-slate-800 text-slate-100 border-slate-700" placeholder="+2547…" value={sendTo} onChange={(e)=>setSendTo(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Template (optional)</label>
            <input className="border rounded px-2 py-1 w-56 bg-slate-800 text-slate-100 border-slate-700" placeholder="template_name" value={sendTemplate} onChange={(e)=>setSendTemplate(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs">Params (comma-separated)</label>
            <input className="border rounded px-2 py-1 w-72 bg-slate-800 text-slate-100 border-slate-700" placeholder="p1,p2,p3" value={sendParams} onChange={(e)=>setSendParams(e.target.value)} />
          </div>
          <div className="flex-1 flex flex-col min-w-[280px]">
            <label className="text-xs">Or Text</label>
            <input className="border rounded px-2 py-1 bg-slate-800 text-slate-100 border-slate-700" placeholder="Plain text to send" value={sendText} onChange={(e)=>setSendText(e.target.value)} />
          </div>
          <button
            className="border rounded px-3 py-1 bg-slate-700 text-slate-100 border-slate-600"
            disabled={sending || !sendTo || (!sendTemplate && !sendText)}
            onClick={async ()=>{
              try {
                setSending(true);
                const to = sendTo.startsWith("+") ? sendTo : `+${sendTo}`;
                if (sendTemplate) {
                  const body = { to, template: sendTemplate, params: sendParams ? sendParams.split(",").map(s=>s.trim()) : [] };
                  const r = await fetch("/api/wa/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                  const j = await r.json();
                  if (!j?.ok) throw new Error(j?.error || "send failed");
                } else {
                  const r = await fetch("/api/wa/send-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, text: sendText }) });
                  const j = await r.json();
                  if (!j?.ok) throw new Error(j?.error || "send failed");
                }
                setSendText("");
                await load();
                notifyToast("Sent ✅");
              } catch (e: any) {
                notifyToast("Send failed: " + String(e?.message || e));
              } finally {
                setSending(false);
              }
            }}
          >{sending ? "Sending…" : "Send"}</button>
        </div>
      </div>

      {/* Flow configuration controls */}
      <div className="rounded border border-slate-700 p-3 bg-slate-900">
        <h2 className="font-medium mb-2">Flow Configuration</h2>
        <div className="text-xs text-gray-600 mb-3">Toggle features for Attendant, Supplier, and Supervisor WhatsApp menus. Changes apply to new messages immediately.</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded border border-slate-700 p-2 bg-slate-900">
            <h3 className="font-medium mb-2">Attendant</h3>
            {!attendantCfg ? (
              <div className="text-sm">{cfgLoading ? "Loading…" : "No config (using defaults)"}</div>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                {[
                  ["enableExpense", "Enable Expense"],
                  ["enableDeposit", "Enable Deposit"],
                  ["enableTxns", "Enable TXNS view"],
                  ["enableSupplyView", "Enable Supply View"],
                  ["enableSummary", "Enable Summary"],
                  ["enableSubmitAndLock", "Enable Submit & Lock"],
                  ["enableWaste", "Enable Waste entry"],
                ].map(([k, label]) => (
                  <label key={String(k)} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={!!attendantCfg[k as any]} onChange={(e)=>setAttendantCfg((prev:any)=>({ ...prev, [k]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="rounded border border-slate-700 p-2 bg-slate-900">
            <h3 className="font-medium mb-2">Supplier</h3>
            {!supplierCfg ? (
              <div className="text-sm">{cfgLoading ? "Loading…" : "No config (using defaults)"}</div>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                {[
                  ["enableTransfer", "Enable Transfer"],
                  ["enableRecent", "Enable Recent"],
                  ["enableDisputes", "Enable Disputes"],
                ].map(([k, label]) => (
                  <label key={String(k)} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={!!supplierCfg[k as any]} onChange={(e)=>setSupplierCfg((prev:any)=>({ ...prev, [k]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="rounded border border-slate-700 p-2 bg-slate-900">
            <h3 className="font-medium mb-2">Supervisor</h3>
            {!supervisorCfg ? (
              <div className="text-sm">{cfgLoading ? "Loading…" : "No config (using defaults)"}</div>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                {[
                  ["showReview", "Show Review"],
                  ["showTxns", "Show TXNS"],
                  ["showLogout", "Show Logout"],
                ].map(([k, label]) => (
                  <label key={String(k)} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={!!supervisorCfg[k as any]} onChange={(e)=>setSupervisorCfg((prev:any)=>({ ...prev, [k]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="border rounded px-3 py-1 bg-slate-700 text-slate-100 border-slate-600" disabled={cfgLoading} onClick={loadConfig}>Reload</button>
          <button
            className="border rounded px-3 py-1 bg-slate-700 text-slate-100 border-slate-600"
            disabled={cfgSaving || !attendantCfg || !supplierCfg || !supervisorCfg}
            onClick={async ()=>{
              try {
                setCfgSaving(true);
                await Promise.all([
                  fetch("/api/settings/wa_flow_attendant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: attendantCfg }) }),
                  fetch("/api/settings/wa_flow_supplier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: supplierCfg }) }),
                  fetch("/api/settings/wa_flow_supervisor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: supervisorCfg }) }),
                ]);
                notifyToast("Saved ✅");
              } catch (e:any) {
                notifyToast("Save failed: " + String(e?.message || e));
              } finally {
                setCfgSaving(false);
              }
            }}
          >{cfgSaving ? "Saving…" : "Save"}</button>
        </div>
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
                <td className="p-2 font-mono text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{r.preview}</span>
                    {!!r.phone && (
                      <button
                        className="border rounded px-2 py-1 text-xs"
                        title="Reply"
                        onClick={()=>{ setSendTo(r.phone); setSendTemplate(""); setSendParams(""); setSendText(""); }}
                      >Reply</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

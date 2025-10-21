"use client";
import { useEffect, useState } from "react";
import { promptSync } from '@/lib/ui';

type Deposit = {
  id: string;
  date: string;
  outletName: string;
  amount: number;
  status: string;
  code?: string | null;
  note?: string | null;
  verifyPayload?: any;
  createdAt: string;
};

export default function AdminDepositsPage() {
  const [rows, setRows] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [stats, setStats] = useState<{ totalPending: number; byOutlet: Record<string, number> } | null>(null);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [outlet, setOutlet] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (date) qs.set('date', date);
      if (outlet) qs.set('outlet', outlet);
      const res = await fetch(`/api/admin/deposits?${qs.toString()}`, { cache: 'no-store' });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'Failed');
      setRows(j.deposits || []);
      // Fetch stats in parallel
      try {
        const sres = await fetch(`/api/admin/deposits?stats=1&${qs.toString()}`, { cache: 'no-store' });
        const sj = await sres.json();
        if (sj?.ok && sj.stats) setStats(sj.stats);
      } catch {}
    } catch (e:any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ load(); }, []);

  return (
    <div className="p-4 bg-slate-900 text-slate-100 min-h-screen">
      <h1 className="text-lg font-semibold">Deposits</h1>
      <div className="mt-1 mb-3 text-sm text-slate-300">
        Pending: <strong className="text-yellow-300">{stats?.totalPending ?? rows.filter(r=>r.status==='PENDING').length}</strong>
        {stats?.byOutlet && Object.keys(stats.byOutlet).length ? (
          <details className="inline-block ml-3 text-xs"><summary className="cursor-pointer">by outlet</summary>
            <div className="mt-1">
              {Object.entries(stats.byOutlet).map(([k,v]) => (<div key={k} className="text-xs">{k}: <strong>{v}</strong></div>))}
            </div>
          </details>
        ) : null}
      </div>
  <div className="flex gap-2 items-end my-3">
        <div className="flex flex-col">
          <label className="text-xs">Date</label>
          <input className="border rounded px-2 py-1" type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs">Outlet</label>
          <input className="border rounded px-2 py-1" placeholder="outlet" value={outlet} onChange={(e)=>setOutlet(e.target.value)} />
        </div>
        <button className="border rounded px-3 py-1" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <div className="ml-4">
          <button className="border rounded px-3 py-1 mr-2" onClick={()=>setOnlyPending(p=>!p)}>{onlyPending ? 'Show all' : 'Show only pending'}</button>
          <span className="text-sm text-slate-300">Pending: <strong className="text-yellow-300">{rows.filter(r=>r.status==='PENDING').length}</strong></span>
        </div>
      </div>

      <div className="overflow-auto rounded border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-200">
            <tr>
              <th className="p-2 text-left">Created</th>
              <th className="p-2 text-left">Outlet</th>
              <th className="p-2 text-left">Amount</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Note</th>
              <th className="p-2 text-left">VerifyPayload</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter(r => !onlyPending || r.status === 'PENDING').map(r => (
              <tr key={r.id} className="odd:bg-slate-900 even:bg-slate-800">
                <td className="p-2 align-top">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-2 align-top">{r.outletName}</td>
                <td className="p-2 align-top">KSh {r.amount}</td>
                <td className="p-2 align-top">
                  {r.status}
                  {r.status === 'PENDING' && (Date.now() - new Date(r.createdAt).getTime()) < 24 * 3600 * 1000 ? (
                    <span className="ml-2 inline-block bg-yellow-400 text-black text-xs px-2 py-0.5 rounded">New</span>
                  ) : null}
                </td>
                <td className="p-2 align-top">{r.code || '—'}</td>
                <td className="p-2 align-top"><div className="max-w-xs break-words">{r.note}</div></td>
                <td className="p-2 align-top">
                  {r.verifyPayload ? (
                    <details>
                      <summary className="cursor-pointer">View</summary>
                      <pre className="text-xs max-w-2xl overflow-auto p-2">{JSON.stringify(r.verifyPayload, null, 2)}</pre>
                    </details>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="p-2 align-top">
                  {r.status === 'PENDING' ? (
                    <div className="flex gap-2">
                      <button className="px-2 py-1 bg-green-600 rounded" onClick={async ()=>{ try { await fetch('/api/admin/edit/deposit', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ id: r.id, status: 'VALID' }) }); await load(); } catch(e){ console.error(e); } }}>Mark VALID</button>
                      <button className="px-2 py-1 bg-red-600 rounded" onClick={async ()=>{ try { const reason = promptSync('Reason for invalidation (optional)') || undefined; await fetch('/api/admin/edit/deposit', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ id: r.id, status: 'INVALID', note: reason }) }); await load(); } catch(e){ console.error(e); } }}>Mark INVALID</button>
                    </div>
                  ) : (<span className="text-slate-400">—</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

type Deposit = {
  id: string;
  date: string;
  outletName: string;
  amount: number;
  status: string;
  note?: string | null;
  verifyPayload?: any;
  createdAt: string;
};

export default function AdminDepositsPage() {
  const [rows, setRows] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(false);
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
            {rows.map(r => (
              <tr key={r.id} className="odd:bg-slate-900 even:bg-slate-800">
                <td className="p-2 align-top">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-2 align-top">{r.outletName}</td>
                <td className="p-2 align-top">KSh {r.amount}</td>
                <td className="p-2 align-top">{r.status}</td>
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
                      <button className="px-2 py-1 bg-red-600 rounded" onClick={async ()=>{ try { const reason = prompt('Reason for invalidation (optional)') || undefined; await fetch('/api/admin/edit/deposit', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ id: r.id, status: 'INVALID', note: reason }) }); await load(); } catch(e){ console.error(e); } }}>Mark INVALID</button>
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

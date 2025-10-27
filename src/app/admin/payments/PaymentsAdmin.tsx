"use client";
import React, { useState, useEffect } from 'react';
import { ToastProvider, useToast } from '@/components/ToastProvider';

type Payment = any;

export default function PaymentsAdmin({ payments, orphans, outletTotals }: { payments: Payment[]; orphans: Payment[]; outletTotals: any }) {
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [selectedOrphan, setSelectedOrphan] = useState<any>(null);
  const [outletInput, setOutletInput] = useState('');
  const [paymentsState, setPaymentsState] = useState<Payment[]>(payments || []);
  const [orphansState, setOrphansState] = useState<Payment[]>(orphans || []);
  const [outletTotalsState, setOutletTotalsState] = useState<any>({ ...outletTotals });
  const { showToast } = useToast();

  const filtered = paymentsState.filter(p => (filterOutlet ? p.outletCode === filterOutlet : true) && (filterStatus ? p.status === filterStatus : true));

  async function attachOrphan() {
    if (!selectedOrphan || !outletInput) return;
    const headers: any = { 'content-type': 'application/json' };
    try {
      try {
        const { getAdminAuth } = await import('@/lib/auth/clientState');
        const val = getAdminAuth();
        if (val) headers['x-admin-auth'] = 'true';
      } catch {
        const isAdmin = typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true';
        if (isAdmin) headers['x-admin-auth'] = 'true';
      }
    } catch (e) {}
    const res = await fetch('/api/admin/payments/attach', { method: 'POST', headers, body: JSON.stringify({ id: selectedOrphan.id, outlet: outletInput }) });
    const j = await res.json();
  if (j.ok) {
      // optimistic update: remove orphan locally and add to payments + update totals
      setShowAttach(false);
      setSelectedOrphan(null);
      setOrphansState(prev => prev.filter(o => o.id !== j.data.id));
      // add to payments list as SUCCESS
      const moved = { ...j.data };
      setPaymentsState(prev => [moved, ...prev]);
      // update outlet totals deposits
      setOutletTotalsState((prev:any) => {
        const copy = { ...prev };
        if (!copy[outletInput]) copy[outletInput] = { deposits: 0, expected: 0 };
        copy[outletInput] = { ...copy[outletInput], deposits: (Number(copy[outletInput].deposits || 0) + Number(moved.amount || 0)), expected: copy[outletInput].expected || 0 };
        return copy;
      });
          showToast({ type: 'success', message: 'Orphan attached' });
    } else {
          showToast({ type: 'error', message: 'Attach failed: ' + (j.error || 'unknown') });
    }
  }

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <select value={filterOutlet} onChange={(e)=>setFilterOutlet(e.target.value)} className="border p-2">
          <option value="">All outlets</option>
          {Object.keys(outletTotalsState).map(o=> <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value)} className="border p-2">
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {Object.entries(outletTotalsState).map(([o,t]:any)=> (
          <div key={o} className="p-3 border rounded">
            <div className="font-semibold">{o}</div>
            <div>Deposits: KSh {t.deposits}</div>
            <div>Expected: KSh {t.expected}</div>
            <div className={`${t.deposits - t.expected === 0 ? 'text-green-600' : (t.deposits - t.expected < 0 ? 'text-amber-600' : 'text-red-600')}`}>Diff: KSh {t.deposits - t.expected}</div>
          </div>
        ))}
      </div>

      <table className="w-full mb-6">
        <thead><tr><th>Date</th><th>Outlet</th><th>Till</th><th>Amount</th><th>Phone</th><th>Receipt</th><th>Status</th></tr></thead>
        <tbody>
          {filtered.map((p:any) => (
            <tr key={p.id}><td>{new Date(p.createdAt).toLocaleString()}</td><td>{p.outletCode}</td><td>{p.storeNumber}</td><td>{p.amount}</td><td>{p.msisdn}</td><td>{p.mpesaReceipt}</td><td>{p.status}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-xl mb-2">Orphans</h2>
      <datalist id="outlet-codes">
        {Object.keys(outletTotalsState).map(o=> <option key={o} value={o} />)}
      </datalist>
      <table className="w-full">
        <thead><tr><th>Date</th><th>Amount</th><th>Phone</th><th>Attach</th></tr></thead>
        <tbody>
          {orphansState.map((o:any) => (
            <tr key={o.id}><td>{new Date(o.createdAt).toLocaleString()}</td><td>{o.amount}</td><td>{o.msisdn}</td><td><button className="btn" onClick={()=>{ setSelectedOrphan(o); setShowAttach(true); }}>Attach</button></td></tr>
          ))}
        </tbody>
      </table>

      {showAttach && selectedOrphan && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white p-6 rounded shadow">
            <h3 className="font-bold">Attach orphan {selectedOrphan.id}</h3>
            <div className="mt-2"><label>Outlet code</label><input list="outlet-codes" className="border p-2 ml-2" value={outletInput} onChange={e=>setOutletInput(e.target.value)} placeholder="BRIGHT"/></div>
            <div className="mt-4 flex gap-2"><button className="btn" onClick={attachOrphan}>Attach</button><button className="btn" onClick={()=>setShowAttach(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* Toasts are rendered by ToastProvider */}
    </div>
  );
}

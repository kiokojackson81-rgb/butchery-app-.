"use client";
import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ToastProvider, useToast } from '@/components/ToastProvider';

type Payment = any;

export default function PaymentsAdmin({ payments, orphans, outletTotals }: { payments: Payment[]; orphans: Payment[]; outletTotals: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [period, setPeriod] = useState<string>(searchParams.get('period') || 'today');
  const [sort, setSort] = useState<string>(searchParams.get('sort') || 'createdAt:desc');
  const [showAttach, setShowAttach] = useState(false);
  const [selectedOrphan, setSelectedOrphan] = useState<any>(null);
  const [outletInput, setOutletInput] = useState('');
  const [paymentsState, setPaymentsState] = useState<Payment[]>(payments || []);
  const [orphansState, setOrphansState] = useState<Payment[]>(orphans || []);
  const [outletTotalsState, setOutletTotalsState] = useState<any>({ ...outletTotals });
  // Track rows that were reassigned (outlet or period) for audit badges; persist in session to survive refresh
  const [reassignedIds, setReassignedIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  // Sync filters from URL on mount/param change
  useEffect(() => {
    const o = searchParams.get('outlet') || '';
    const s = searchParams.get('status') || '';
    const p = searchParams.get('period') || 'today';
    const so = searchParams.get('sort') || 'createdAt:desc';
    setFilterOutlet(o);
    setFilterStatus(s);
    setPeriod(p);
    setSort(so);
  }, [searchParams]);

  // Keep tiles in sync when server props refresh after actions
  useEffect(() => {
    setOutletTotalsState({ ...outletTotals });
  }, [outletTotals]);

  // Load reassigned IDs from session on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('admin_payments_reassigned') || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setReassignedIds(new Set(arr.map(String)));
    } catch {}
  }, []);

  function markReassigned(id: string) {
    setReassignedIds(prev => {
      const next = new Set(prev);
      next.add(String(id));
      try { sessionStorage.setItem('admin_payments_reassigned', JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  function pushParams(next: Partial<Record<string, string>>) {
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    router.push(qs ? `?${qs}` : '?');
  }

  function onChangePeriod(val: string) {
    setPeriod(val);
    pushParams({ period: val });
  }

  function onChangeSort(val: string) {
    setSort(val);
    pushParams({ sort: val });
  }

  function onChangeOutlet(val: string) {
    setFilterOutlet(val);
    pushParams({ outlet: val || '' });
  }

  function onChangeStatus(val: string) {
    setFilterStatus(val);
    pushParams({ status: val || '' });
  }

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
      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <select value={period} onChange={(e)=>onChangePeriod(e.target.value)} className="border p-2">
          <option value="today">Current Period</option>
          <option value="yesterday">Yesterday</option>
          <option value="last7">Last 7 days</option>
          <option value="all">All time</option>
        </select>

        <select value={sort} onChange={(e)=>onChangeSort(e.target.value)} className="border p-2">
          <option value="createdAt:desc">Newest first</option>
          <option value="createdAt:asc">Oldest first</option>
          <option value="amount:desc">Amount high → low</option>
          <option value="amount:asc">Amount low → high</option>
          <option value="status:asc">Status A→Z</option>
          <option value="status:desc">Status Z→A</option>
          <option value="outletCode:asc">Outlet A→Z</option>
          <option value="outletCode:desc">Outlet Z→A</option>
        </select>

        <select value={filterOutlet} onChange={(e)=>onChangeOutlet(e.target.value)} className="border p-2">
          <option value="">All outlets</option>
          {Object.keys(outletTotalsState).map(o=> <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={filterStatus} onChange={(e)=>onChangeStatus(e.target.value)} className="border p-2">
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {Object.entries(outletTotalsState).map(([o,t]:any)=> {
          const tillGross = Number(t.tillGross || 0);
          const expected = Number(t.expected || 0);
          const diff = tillGross - expected;
          return (
            <div key={o} className="p-3 border rounded">
              <div className="font-semibold">{o}</div>
              <div>Till Paid (Gross): KSh {tillGross}</div>
              <div>Expected (Closing Sales): KSh {expected}</div>
              <div className={`${diff === 0 ? 'text-green-600' : (diff < 0 ? 'text-amber-600' : 'text-red-600')}`}>Diff: KSh {diff}</div>
            </div>
          );
        })}
      </div>

      <table className="w-full mb-6">
        <thead>
          <tr>
            <th>Date</th><th>Outlet</th><th>Shortcode Used</th><th>Amount</th><th>Phone</th><th>Receipt</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p:any) => {
            const shortcode = p.businessShortCode || p.tillNumber || p.storeNumber || p.headOfficeNumber || '';
            // Local state for inline outlet move input
            const [value, setValue] = [undefined, undefined] as any;
            return (
              <tr key={p.id}>
                <td>
                  {new Date(p.createdAt).toLocaleString()}
                  {reassignedIds.has(String(p.id)) && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">Reassigned</span>
                  )}
                </td>
                <td>{p.outletCode}</td>
                <td>{shortcode}</td>
                <td>{p.amount}</td>
                <td>{p.msisdn}</td>
                <td>{p.mpesaReceipt}</td>
                <td>{p.status}</td>
                <td>
                  <RowActions p={p} onUpdated={(np)=>{
                    setPaymentsState(prev=> prev.map(x=> x.id===np.id ? { ...x, ...np } : x));
                  }} onMarkChanged={() => { markReassigned(String(p.id)); }} />
                </td>
              </tr>
            );
          })}
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

function useAdminHeaders() {
  const headers: any = { 'content-type': 'application/json' };
  return (async () => {
    try {
      try {
        const { getAdminAuth } = await import('@/lib/auth/clientState');
        const val = getAdminAuth();
        if (val) headers['x-admin-auth'] = 'true';
      } catch {
        const isAdmin = typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === 'true';
        if (isAdmin) headers['x-admin-auth'] = 'true';
      }
    } catch {}
    return headers;
  })();
}

function RowActions({ p, onUpdated, onMarkChanged }: { p: any; onUpdated: (np:any)=>void; onMarkChanged: ()=>void }) {
  const { showToast } = useToast();
  const [moveOutlet, setMoveOutlet] = useState<string>('');
  const router = useRouter();

  useEffect(()=>{ setMoveOutlet(p?.outletCode || ''); }, [p?.outletCode]);

  async function doMoveOutlet() {
    try {
      const headers = await useAdminHeaders();
      const res = await fetch('/api/admin/payments/attach', { method: 'POST', headers, body: JSON.stringify({ id: p.id, outlet: moveOutlet }) });
      const j = await res.json();
      if (j.ok) { onUpdated(j.data); onMarkChanged(); showToast({ type: 'success', message: 'Outlet moved' }); router.refresh(); }
      else showToast({ type: 'error', message: 'Move failed: ' + (j.error || 'unknown') });
    } catch (e:any) { showToast({ type: 'error', message: String(e) }); }
  }

  async function assignPeriod(to: 'current'|'previous') {
    try {
      const headers = await useAdminHeaders();
      const res = await fetch('/api/admin/payments/assign-period', { method: 'POST', headers, body: JSON.stringify({ id: p.id, to }) });
      const j = await res.json();
      if (j.ok) { onUpdated(j.payment); onMarkChanged(); showToast({ type: 'success', message: `Assigned to ${to}` }); router.refresh(); }
      else showToast({ type: 'error', message: 'Assign failed: ' + (j.error || 'unknown') });
    } catch (e:any) { showToast({ type: 'error', message: String(e) }); }
  }

  return (
    <div className="flex items-center gap-2">
      <input list="outlet-codes" className="border p-1 w-28" value={moveOutlet} onChange={e=>setMoveOutlet(e.target.value)} />
      <button className="text-blue-600 underline text-sm" onClick={doMoveOutlet}>Move</button>
      <span className="text-gray-400">|</span>
      <button className="text-sm px-2 py-1 border rounded" onClick={()=>assignPeriod('current')}>To Current</button>
      <button className="text-sm px-2 py-1 border rounded" onClick={()=>assignPeriod('previous')}>To Prev</button>
    </div>
  );
}

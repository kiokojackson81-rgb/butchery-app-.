// src/app/supplier/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ========= Types ========= */
type Unit = "kg" | "pcs";
type Product = { id: string; key: string; name: string; unit: Unit; sellPrice: number; active: boolean };
type Outlet  = { id: string; name: string; code: string; active: boolean };
type SupplyRow = { id: string; itemKey: string; qty: number | ""; buyPrice?: number | "" };

/* ========= Storage Keys (must match other pages) ========= */
const K_OUTLETS   = "admin_outlets";
const K_PRODUCTS  = "admin_products";
const openingKey  = (date: string, outletName: string) => `supplier_opening_${date}_${outletName}`;
const lockedKey   = (date: string, outletName: string) => `supplier_locked_${date}_${outletName}`;
const amendKey    = "supplier_amend_requests";
const transfersKey= (date: string) => `supplier_transfers_${date}`;

/* ========= Helpers ========= */
const today = () => new Date().toISOString().split("T")[0];
const rid = () => Math.random().toString(36).slice(2);
const toNum = (v: number | "" | undefined) => (typeof v === "number" ? v : v ? Number(v) : 0);

function readLS<T>(k: string, fallback: T): T {
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeLS<T>(k: string, v: T) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/* ========= Page ========= */
export default function SupplierDashboard() {
  const [tab, setTab] = useState<"supply" | "transfers" | "my-submissions">("supply");

  // Admin-configured data
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Filters
  const [dateStr, setDateStr] = useState<string>(today());
  const [outletName, setOutletName] = useState<string>("");

  // Supply rows
  const [rows, setRows] = useState<SupplyRow[]>([{ id: rid(), itemKey: "", qty: "", buyPrice: "" }]);

  // Locked flag
  const isLocked = useMemo(() => {
    return outletName ? !!readLS<boolean>(lockedKey(dateStr, outletName), false) : false;
  }, [dateStr, outletName]);

  // Transfers
  const [fromOutlet, setFromOutlet] = useState<string>("");
  const [toOutlet, setToOutlet] = useState<string>("");
  const [transferRows, setTransferRows] = useState<Array<{ id: string; itemKey: string; qty: number | "" }>>([
    { id: rid(), itemKey: "", qty: "" },
  ]);

  // Submissions list (for quick view)
  const mySubs = useMemo(() => {
    if (!outletName) return [];
    return readLS<any[]>(openingKey(dateStr, outletName), []);
  }, [dateStr, outletName]);

  /* ----- Load admin data ----- */
  useEffect(() => {
    setOutlets(readLS<Outlet[]>(K_OUTLETS, []));
    setProducts(readLS<Product[]>(K_PRODUCTS, []));
  }, []);

  /* ----- Ensure outlet selection defaults ----- */
  useEffect(() => {
    if (!outletName && outlets.length) {
      // default to first active outlet
      const firstActive = outlets.find(o => o.active) || outlets[0];
      setOutletName(firstActive?.name || "");
    }
    if (!fromOutlet && outlets.length) setFromOutlet(outlets[0]?.name || "");
    if (!toOutlet && outlets.length) setToOutlet(outlets[1]?.name || outlets[0]?.name || "");
  }, [outlets]); // eslint-disable-line

  /* ========= Supply Tab actions ========= */
  const addRow = () => setRows(v => [...v, { id: rid(), itemKey: "", qty: "", buyPrice: "" }]);
  const rmRow  = (id: string) => setRows(v => v.length === 1 ? v : v.filter(r => r.id !== id));
  const upRow  = (id: string, patch: Partial<SupplyRow>) => setRows(v => v.map(r => r.id === id ? { ...r, ...patch } : r));

  const submitSupply = () => {
    if (!outletName) return alert("Select an outlet.");
    if (isLocked)   return alert("This outlet is already locked for the selected date.");

    // Validate
    const cleaned = rows
      .map(r => ({
        itemKey: (r.itemKey || "").trim(),
        qty: toNum(r.qty),
        buyPrice: r.buyPrice === "" ? undefined : toNum(r.buyPrice),
      }))
      .filter(r => r.itemKey && r.qty > 0);

    if (cleaned.length === 0) return alert("Add at least one valid supply row.");

    // Read current (if any) and append
    const prev = readLS<any[]>(openingKey(dateStr, outletName), []);
    const next = [...prev, ...cleaned];
    writeLS(openingKey(dateStr, outletName), next);

    // Lock this date+outlet
    writeLS(lockedKey(dateStr, outletName), true);

    alert(`Supply saved and locked for ${outletName} (${dateStr}).`);
  };

  const requestAmendment = () => {
    if (!outletName) return alert("Select an outlet.");
    const note = prompt("Describe the amendment you need (reason/changes):", "");
    if (!note) return;
    const entry = {
      id: rid(),
      date: dateStr,
      outlet: outletName,
      note,
      state: "pending",
      type: "supply" as const,
    };
    const list = readLS<any[]>(amendKey, []);
    writeLS(amendKey, [entry, ...list]);
    alert("Amendment request sent to Supervisor.");
  };

  /* ========= Transfer Tab actions ========= */
  const addTransferRow = () => setTransferRows(v => [...v, { id: rid(), itemKey: "", qty: "" }]);
  const rmTransferRow  = (id: string) => setTransferRows(v => v.length === 1 ? v : v.filter(r => r.id !== id));
  const upTransferRow  = (id: string, patch: Partial<{ itemKey: string; qty: number | "" }>) =>
    setTransferRows(v => v.map(r => r.id === id ? { ...r, ...patch } : r));

  const submitTransfer = () => {
    if (!fromOutlet || !toOutlet) return alert("Select both From and To outlets.");
    if (fromOutlet === toOutlet)  return alert("From and To outlets must be different.");

    const cleaned = transferRows
      .map(r => ({ itemKey: (r.itemKey || "").trim(), qty: toNum(r.qty) }))
      .filter(r => r.itemKey && r.qty > 0);
    if (cleaned.length === 0) return alert("Add at least one valid transfer row.");

    // Apply to opening stocks:
    const fromArr = readLS<any[]>(openingKey(dateStr, fromOutlet), []);
    const toArr   = readLS<any[]>(openingKey(dateStr, toOutlet), []);

    // Subtract from "fromOutlet" by adding negative qty entries
    const fromNext = [...fromArr, ...cleaned.map(x => ({ itemKey: x.itemKey, qty: -x.qty }))];
    // Add to "toOutlet"
    const toNext   = [...toArr,   ...cleaned.map(x => ({ itemKey: x.itemKey, qty:  x.qty }))];

    writeLS(openingKey(dateStr, fromOutlet), fromNext);
    writeLS(openingKey(dateStr, toOutlet),   toNext);

    // Log transfer
    const log = readLS<any[]>(transfersKey(dateStr), []);
    log.unshift({
      id: rid(),
      date: dateStr,
      from: fromOutlet,
      to: toOutlet,
      rows: cleaned,
    });
    writeLS(transfersKey(dateStr), log);

    alert("Transfer applied to both outlets for today.");
  };

  /* ========= UI ========= */
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Supplier Dashboard</h1>
          <p className="text-xs text-gray-600">Capture supply and transfers. Submitted outlets lock for the selected date.</p>
        </div>
        <nav className="flex gap-2">
          <TabBtn active={tab==="supply"} onClick={()=>setTab("supply")}>Supply</TabBtn>
          <TabBtn active={tab==="transfers"} onClick={()=>setTab("transfers")}>Transfers</TabBtn>
          <TabBtn active={tab==="my-submissions"} onClick={()=>setTab("my-submissions")}>My Submissions</TabBtn>
        </nav>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="border rounded-xl p-2 text-sm" type="date" value={dateStr} onChange={(e)=>setDateStr(e.target.value)} />
        <select className="border rounded-xl p-2 text-sm" value={outletName} onChange={(e)=>setOutletName(e.target.value)}>
          {outlets.length === 0 && <option value="">(No outlets configured)</option>}
          {outlets.map(o => (
            <option key={o.id} value={o.name}>
              {o.name} {readLS<boolean>(lockedKey(dateStr, o.name), false) ? "— (locked)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* SUPPLY TAB */}
      {tab === "supply" && (
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Supply for {outletName || "—"} — {dateStr}</h2>
            {isLocked && <span className="text-xs px-2 py-1 rounded bg-gray-200">Locked</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Product</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Buy Price (optional)</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const prod = products.find(p => p.key === r.itemKey);
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="py-2">
                        <select
                          className="border rounded-xl p-2 w-56"
                          value={r.itemKey}
                          onChange={(e)=>upRow(r.id,{ itemKey: e.target.value })}
                          disabled={isLocked}
                        >
                          <option value="">Select product…</option>
                          {products.filter(p=>p.active).map(p=>(
                            <option key={p.id} value={p.key}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="border rounded-xl p-2 w-28"
                          type="number" min={0} step={prod?.unit === "kg" ? 0.01 : 1}
                          value={r.qty}
                          onChange={(e)=>upRow(r.id,{ qty: e.target.value === "" ? "" : Number(e.target.value) })}
                          placeholder="0"
                          disabled={isLocked}
                        />
                      </td>
                      <td>{prod?.unit || "—"}</td>
                      <td>
                        <input
                          className="border rounded-xl p-2 w-36"
                          type="number" min={0} step={1}
                          value={r.buyPrice ?? ""}
                          onChange={(e)=>upRow(r.id,{ buyPrice: e.target.value === "" ? "" : Number(e.target.value) })}
                          placeholder="Ksh"
                          disabled={isLocked}
                        />
                      </td>
                      <td>
                        <button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmRow(r.id)} disabled={isLocked || rows.length===1}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addRow} disabled={isLocked}>+ Add item</button>
            <button className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50" onClick={submitSupply} disabled={isLocked || !outletName}>
              Submit & Lock
            </button>
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={requestAmendment}>Request Amendment</button>
          </div>

          <p className="text-xs text-gray-600 mt-2">
            After submit, only this outlet is locked for this date. Others remain active.
          </p>
        </section>
      )}

      {/* TRANSFERS TAB */}
      {tab === "transfers" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Transfer Stock (same day)</h2>

          <div className="flex flex-wrap gap-2 mb-3">
            <label className="text-sm">From:</label>
            <select className="border rounded-xl p-2 text-sm" value={fromOutlet} onChange={(e)=>setFromOutlet(e.target.value)}>
              {outlets.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>

            <label className="text-sm">To:</label>
            <select className="border rounded-xl p-2 text-sm" value={toOutlet} onChange={(e)=>setToOutlet(e.target.value)}>
              {outlets.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Product</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th style={{width:1}}></th>
                </tr>
              </thead>
              <tbody>
                {transferRows.map((r) => {
                  const prod = products.find(p => p.key === r.itemKey);
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="py-2">
                        <select className="border rounded-xl p-2 w-56" value={r.itemKey} onChange={(e)=>upTransferRow(r.id,{ itemKey: e.target.value })}>
                          <option value="">Select product…</option>
                          {products.filter(p=>p.active).map(p=>(
                            <option key={p.id} value={p.key}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="border rounded-xl p-2 w-28"
                          type="number" min={0} step={prod?.unit === "kg" ? 0.01 : 1}
                          value={r.qty}
                          onChange={(e)=>upTransferRow(r.id,{ qty: e.target.value === "" ? "" : Number(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td>{prod?.unit || "—"}</td>
                      <td>
                        <button className="text-xs border rounded-lg px-2 py-1" onClick={()=>rmTransferRow(r.id)} disabled={transferRows.length===1}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button className="border rounded-xl px-3 py-2 text-sm" onClick={addTransferRow}>+ Add transfer</button>
            <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={submitTransfer}>Submit Transfer</button>
          </div>

          <p className="text-xs text-gray-600 mt-2">
            We immediately apply negative qty to the source outlet and positive qty to the destination outlet in today’s opening.
          </p>
        </section>
      )}

      {/* MY SUBMISSIONS (quick read-only view) */}
      {tab === "my-submissions" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">My Submissions — {outletName || "—"} ({dateStr})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Buy Price</th>
                </tr>
              </thead>
              <tbody>
                {mySubs.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-gray-500">No records for this outlet/date.</td></tr>
                )}
                {mySubs.map((r: any, i: number) => {
                  const prod = products.find(p => p.key === r.itemKey);
                  return (
                    <tr key={i} className="border-b">
                      <td className="py-2">{prod?.name || r.itemKey}</td>
                      <td>{r.qty}</td>
                      <td>{prod?.unit || "kg"}</td>
                      <td>{typeof r.buyPrice === "number" ? `Ksh ${r.buyPrice.toLocaleString()}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

/* ========= UI bits ========= */
function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-xl border text-sm ${active ? "bg-black text-white" : "bg-white"}`}>
      {children}
    </button>
  );
}

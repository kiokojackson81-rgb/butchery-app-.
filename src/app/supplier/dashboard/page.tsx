"use client";

import React, { useEffect, useMemo, useState } from "react";

/* =========================
   Types (aligned with Admin)
   ========================= */
type Unit = "kg" | "pcs";

type Product = {
  id: string;
  key: string;               // "beef", "goat", ...
  name: string;
  unit: Unit;
  defaultSellPrice: number;  // not used here, but kept for consistency
  active: boolean;
};

type Outlet = {
  id: string;
  name: string;   // "Bright", "Baraka A", ...
  active: boolean;
};

/** A single supply row (this page) */
type SupplyRow = {
  id: string;
  itemKey: string;    // product.key
  qty: number;        // weight or pieces
  buyPrice: number;   // per unit
  unit: Unit;         // "kg" or "pcs" (copied from product)
};

/** A transfer record (supplier → cross outlet) */
type TransferRow = {
  id: string;
  date: string;       // YYYY-MM-DD
  fromOutletName: string;
  toOutletName: string;
  itemKey: string;
  qty: number;
  unit: Unit;
};

/** A simple amend/modification request (to Supervisor) */
type AmendRequest = {
  id: string;
  date: string;
  outletName: string;
  requestedBy: string; // e.g. supplier code or label
  type: "supply" | "transfer";
  description: string;
  status: "pending" | "approved" | "rejected";
};

/* =========================
   Storage Keys
   ========================= */
/** Opening stock list (what Attendant will use as "Opening" for the day) */
const supplierOpeningKey = (date: string, outletName: string) =>
  `supplier_opening_${date}_${outletName}`; // SupplyRow[]

/** Submission lock (after submit, only supervisor can edit) */
const supplierSubmittedKey = (date: string, outletName: string) =>
  `supplier_submitted_${date}_${outletName}`; // boolean

/** Cross-outlet transfers for a given date */
const supplierTransfersKey = (date: string) => `supplier_transfers_${date}`; // TransferRow[]

/** Global amend requests list */
const AMEND_REQUESTS_KEY = "amend_requests";

/** Admin data keys (from Admin page) */
const K_OUTLETS  = "admin_outlets_v2";   // Outlet[]
const K_PRODUCTS = "admin_products_v2";  // Product[]

/* =========================
   Helpers
   ========================= */
function rid(): string {
  return Math.random().toString(36).slice(2);
}
function ymd(d = new Date()): string {
  return d.toISOString().split("T")[0];
}
function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
function toNumStr(s: string): number {
  return s.trim() === "" ? 0 : Number(s);
}

/* =========================
   Page
   ========================= */
export default function SupplierDashboard(): JSX.Element {
  /* Admin data */
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  /* Selection */
  const [dateStr, setDateStr] = useState<string>(ymd());
  const [outletId, setOutletId] = useState<string>("");

  /* Supply table state */
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [submitted, setSubmitted] = useState<boolean>(false);

  /* Transfers */
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

  /* Quick product map */
  const productByKey = useMemo(() => {
    const map: Record<string, Product> = {};
    for (const p of products) map[p.key] = p;
    return map;
  }, [products]);

  /* Quick outlet map + current names */
  const outletById = useMemo(() => {
    const map: Record<string, Outlet> = {};
    for (const o of outlets) map[o.id] = o;
    return map;
  }, [outlets]);

  const selectedOutletName = useMemo<string>(() => {
    return outletById[outletId]?.name ?? "";
  }, [outletById, outletId]);

  /* Load admin data (once) */
  useEffect(() => {
    setOutlets(loadLS<Outlet[]>(K_OUTLETS, []));
    setProducts(loadLS<Product[]>(K_PRODUCTS, []));
  }, []);

  /* Initialize outlet selection when outlets are loaded */
  useEffect(() => {
    if (outlets.length > 0 && !outletId) {
      setOutletId(outlets[0].id);
    }
  }, [outlets, outletId]);

  /* Load rows + submitted lock when date/outlet changes */
  useEffect(() => {
    if (!selectedOutletName) return;

    const loaded = loadLS<SupplyRow[]>(
      supplierOpeningKey(dateStr, selectedOutletName),
      []
    );
    setRows(loaded);

    const isSubmitted = loadLS<boolean>(
      supplierSubmittedKey(dateStr, selectedOutletName),
      false
    );
    setSubmitted(isSubmitted);

    // load transfers for date
    const tx = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
    setTransfers(tx);
  }, [dateStr, selectedOutletName]);

  /* ===== Row operations ===== */
  const addRow = (itemKey: string): void => {
    if (!itemKey) return;
    const p = productByKey[itemKey];
    if (!p) return;

    setRows((prev) => [
      ...prev,
      { id: rid(), itemKey: itemKey, qty: 0, buyPrice: 0, unit: p.unit },
    ]);
  };

  const updateRow = (id: string, patch: Partial<SupplyRow>): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string): void => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /* ===== Submit (lock) ===== */
  const submitDay = (): void => {
    if (!selectedOutletName) return;
    // Save rows
    saveLS(supplierOpeningKey(dateStr, selectedOutletName), rows);
    // Lock
    saveLS(supplierSubmittedKey(dateStr, selectedOutletName), true);
    setSubmitted(true);
    alert("Supply submitted and locked. Supervisor can edit later.");
  };

  /* ===== Request modification to Supervisor ===== */
  const requestModification = (): void => {
    if (!selectedOutletName) return;

    const note = window.prompt("Describe what needs to be corrected:", "");
    if (!note) return;

    const req: AmendRequest = {
      id: rid(),
      date: dateStr,
      outletName: selectedOutletName,
      requestedBy: "supplier",
      type: "supply",
      description: note,
      status: "pending",
    };

    const list = loadLS<AmendRequest[]>(AMEND_REQUESTS_KEY, []);
    const next = [req, ...list];
    saveLS(AMEND_REQUESTS_KEY, next);
    alert("Modification request sent to Supervisor.");
  };

  /* ===== Transfers ===== */
  const [txFromId, setTxFromId] = useState<string>("");
  const [txToId, setTxToId] = useState<string>("");
  const [txProductKey, setTxProductKey] = useState<string>("");
  const [txQty, setTxQty] = useState<string>("");

  useEffect(() => {
    // default from/to
    if (!txFromId && outlets.length) setTxFromId(outlets[0].id);
    if (!txToId && outlets.length > 1) setTxToId(outlets[1].id);
  }, [outlets, txFromId, txToId]);

  const addTransfer = (): void => {
    const fromName = outletById[txFromId]?.name ?? "";
    const toName = outletById[txToId]?.name ?? "";
    if (!fromName || !toName) {
      alert("Please select valid outlets.");
      return;
    }
    if (fromName === toName) {
      alert("From and To outlets must be different.");
      return;
    }
    const p = productByKey[txProductKey];
    if (!p) {
      alert("Please select a product to transfer.");
      return;
    }
    const qtyNum = toNumStr(txQty);
    if (qtyNum <= 0) {
      alert("Quantity must be greater than 0.");
      return;
    }

    // 1) Save the transfer record
    const rec: TransferRow = {
      id: rid(),
      date: dateStr,
      fromOutletName: fromName,
      toOutletName: toName,
      itemKey: txProductKey,
      qty: qtyNum,
      unit: p.unit,
    };
    const txList = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
    const nextTx = [rec, ...txList];
    saveLS(supplierTransfersKey(dateStr), nextTx);
    setTransfers(nextTx);

    // 2) Reduce from-outlet opening for the day
    const fromRows = loadLS<SupplyRow[]>(
      supplierOpeningKey(dateStr, fromName),
      []
    );
    const fromUpdated = adjustSupply(fromRows, txProductKey, -qtyNum, p.unit);
    saveLS(supplierOpeningKey(dateStr, fromName), fromUpdated);

    // 3) Increase to-outlet opening for the day
    const toRows = loadLS<SupplyRow[]>(
      supplierOpeningKey(dateStr, toName),
      []
    );
    const toUpdated = adjustSupply(toRows, txProductKey, +qtyNum, p.unit);
    saveLS(supplierOpeningKey(dateStr, toName), toUpdated);

    alert("Transfer saved and applied to both outlets’ opening.");
    // clear qty only
    setTxQty("");
  };

  function adjustSupply(list: SupplyRow[], itemKey: string, delta: number, unit: Unit): SupplyRow[] {
    // Try find existing row for item; otherwise create a new one
    const idx = list.findIndex((r) => r.itemKey === itemKey);
    if (idx === -1) {
      return [...list, { id: rid(), itemKey, qty: Math.max(0, delta), buyPrice: 0, unit }];
    } else {
      const next = [...list];
      const now = next[idx];
      const newQty = Math.max(0, now.qty + delta);
      next[idx] = { ...now, qty: newQty };
      return next;
    }
  }

  /* ===== Calculations ===== */
  const totals = useMemo(() => {
    let totalQty = 0;
    let totalBuy = 0;
    for (const r of rows) {
      totalQty += r.qty;
      totalBuy += r.qty * r.buyPrice;
    }
    return { totalQty, totalBuy };
  }, [rows]);

  /* ===== Save (without lock) ===== */
  const saveDraft = (): void => {
    if (!selectedOutletName) return;
    saveLS(supplierOpeningKey(dateStr, selectedOutletName), rows);
    alert("Saved.");
  };

  /* ===== Print summary ===== */
  const printSummary = (): void => {
    window.print();
  };

  /* =========================
     Render
     ========================= */
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Supplier Dashboard</h1>
          <p className="text-sm text-gray-600">Enter opening supply and handle transfers.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="border rounded-xl p-2 text-sm"
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
          <select
            className="border rounded-xl p-2 text-sm"
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Supply Editor */}
      <section className="rounded-2xl border p-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Opening Supply — {selectedOutletName || "—"} ({dateStr})</h2>
          <div className="flex gap-2">
            <button className="border rounded-xl px-3 py-1 text-xs" onClick={saveDraft} disabled={!selectedOutletName}>
              Save
            </button>
            <button
              className="border rounded-xl px-3 py-1 text-xs bg-black text-white"
              onClick={submitDay}
              disabled={!selectedOutletName || submitted}
              title={submitted ? "Already submitted (locked)" : "Submit & Lock"}
            >
              {submitted ? "Submitted (Locked)" : "Submit & Lock"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <label className="text-sm text-gray-600">Add Item:</label>
          <select
            className="border rounded-xl p-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              addRow(e.target.value);
              e.currentTarget.value = "";
            }}
            disabled={submitted}
          >
            <option value="" disabled>
              Select product…
            </option>
            {products.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Buy Price / Unit</th>
                <th>Total (Ksh)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={6}>
                    No items yet. Use “Add Item”.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const p = productByKey[r.itemKey];
                const name = p?.name ?? r.itemKey.toUpperCase();
                const unit = p?.unit ?? r.unit;
                const line = r.qty * r.buyPrice;
                return (
                  <tr key={r.id} className="border-b">
                    <td className="py-2">{name}</td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-28"
                        type="number"
                        min={0}
                        step={unit === "kg" ? 0.01 : 1}
                        value={r.qty}
                        onChange={(e) =>
                          updateRow(r.id, { qty: toNumStr(e.target.value) })
                        }
                        disabled={submitted}
                      />
                    </td>
                    <td>{unit}</td>
                    <td>
                      <input
                        className="border rounded-xl p-2 w-28"
                        type="number"
                        min={0}
                        step={1}
                        value={r.buyPrice}
                        onChange={(e) =>
                          updateRow(r.id, { buyPrice: toNumStr(e.target.value) })
                        }
                        disabled={submitted}
                      />
                    </td>
                    <td className="font-medium">{(line || 0).toLocaleString()}</td>
                    <td>
                      {!submitted && (
                        <button
                          className="text-xs border rounded-lg px-2 py-1"
                          onClick={() => removeRow(r.id)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-2 font-semibold" colSpan={4}>
                  Totals
                </td>
                <td className="font-semibold">{totals.totalBuy.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="border rounded-xl px-3 py-1 text-xs" onClick={printSummary}>
            Print
          </button>
          <button className="border rounded-xl px-3 py-1 text-xs" onClick={requestModification}>
            Request Modification
          </button>
        </div>

        {submitted && (
          <p className="text-xs text-green-700 mt-2">
            Submitted and locked. Supervisor can adjust later if needed.
          </p>
        )}
      </section>

      {/* Transfers */}
      <section className="rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Transfers (Between Outlets) — {dateStr}</h2>

        <div className="grid md:grid-cols-5 gap-2 mb-3">
          <select
            className="border rounded-xl p-2 text-sm"
            value={txFromId}
            onChange={(e) => setTxFromId(e.target.value)}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                From: {o.name}
              </option>
            ))}
          </select>

          <select
            className="border rounded-xl p-2 text-sm"
            value={txToId}
            onChange={(e) => setTxToId(e.target.value)}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                To: {o.name}
              </option>
            ))}
          </select>

          <select
            className="border rounded-xl p-2 text-sm"
            value={txProductKey}
            onChange={(e) => setTxProductKey(e.target.value)}
          >
            <option value="">Product…</option>
            {products
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                </option>
              ))}
          </select>

          <input
            className="border rounded-xl p-2 text-sm"
            type="number"
            min={0}
            step={productByKey[txProductKey]?.unit === "kg" ? 0.01 : 1}
            placeholder="Qty"
            value={txQty}
            onChange={(e) => setTxQty(e.target.value)}
          />

          <button className="border rounded-xl px-3 py-2 text-sm" onClick={addTransfer}>
            Save Transfer
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Date</th>
                <th className="p-2">From</th>
                <th className="p-2">To</th>
                <th className="p-2">Item</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 ? (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={6}>
                    No transfers for this date.
                  </td>
                </tr>
              ) : (
                transfers.map((t) => {
                  const name = productByKey[t.itemKey]?.name ?? t.itemKey;
                  return (
                    <tr key={t.id} className="border-t">
                      <td className="p-2">{t.date}</td>
                      <td className="p-2">{t.fromOutletName}</td>
                      <td className="p-2">{t.toOutletName}</td>
                      <td className="p-2">{name}</td>
                      <td className="p-2">{t.qty}</td>
                      <td className="p-2">{t.unit}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-600 mt-2">
          Transfers update the “Opening Supply” of both outlets for this date. Attendants will see the effect when they record closing.
        </p>
      </section>
    </main>
  );
}

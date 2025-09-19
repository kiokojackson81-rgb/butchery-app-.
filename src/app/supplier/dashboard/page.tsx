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
  sellPrice: number;         // Admin global default (kept for info)
  active: boolean;
};

type Outlet = {
  id: string;
  name: string;              // "Bright", "Baraka A", ...
  code?: string;             // legacy field (ignored here)
  active: boolean;
};

/** A single supply row (supplier UI only) */
type SupplyRow = {
  id: string;
  itemKey: string;    // product.key
  qty: number;        // weight or pieces
  buyPrice: number;   // per unit
  unit: Unit;         // "kg" or "pcs" (copied from product)
};

/** Minimal opening row (what Attendant reads) */
type OpeningItem = { itemKey: string; qty: number };

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

/** Disputes (support both Attendant- and Supplier-created shapes) */
type AmendComment = { by: string; at: string; text: string };
type AnyAmend = {
  id: string;
  date: string;
  outlet?: string;             // attendants use 'outlet'
  outletName?: string;         // suppliers may use 'outletName'
  requestedBy?: string;
  type?: string;               // "supply" | "transfer" | "supplier_adjustment"
  itemKey?: string;
  qty?: number;
  description?: string;
  status?: "pending" | "approved" | "rejected";
  createdAt?: string;
  comments?: AmendComment[];
};

/* =========================
   Storage Keys
   ========================= */

/** Minimal Opening list for Attendant (Array<{itemKey, qty}>) */
const supplierOpeningKey = (date: string, outletName: string) =>
  `supplier_opening_${date}_${outletName}`;

/** Supplier private editable copy (SupplyRow[]) */
const supplierOpeningFullKey = (date: string, outletName: string) =>
  `supplier_opening_full_${date}_${outletName}`;

/** Optional cost map (per date/outlet): { [itemKey]: unitCost } */
const supplierCostKey = (date: string, outletName: string) =>
  `supplier_cost_${date}_${outletName}`;

/** Submission lock (after submit, only supervisor can edit) */
const supplierSubmittedKey = (date: string, outletName: string) =>
  `supplier_submitted_${date}_${outletName}`;

/** Cross-outlet transfers for a given date */
const supplierTransfersKey = (date: string) => `supplier_transfers_${date}`;

/** Global amend requests list */
const AMEND_REQUESTS_KEY = "amend_requests";

/** Admin data keys (from Admin page) */
const K_OUTLETS  = "admin_outlets";
const K_PRODUCTS = "admin_products";
const K_PRICEBOOK = "admin_pricebook";

// (Optional fallback if someone used v2 keys earlier)
const K_OUTLETS_V2  = "admin_outlets_v2";
const K_PRODUCTS_V2 = "admin_products_v2";

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
function fmt(n: number) {
  return (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* =========================
   Page
   ========================= */
export default function SupplierDashboard(): JSX.Element {
  /* Admin data */
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pricebook, setPricebook] = useState<Record<string, Record<string, { sellPrice: number; active: boolean }>>>({});

  /* Selection */
  const [dateStr, setDateStr] = useState<string>(ymd());
  const [outletId, setOutletId] = useState<string>("");

  /* Supply table state */
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [submitted, setSubmitted] = useState<boolean>(false);

  /* Transfers */
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

  /* Disputes list for viewing/comment */
  const [amends, setAmends] = useState<AnyAmend[]>([]);

  /* Welcome name */
  const [welcomeName, setWelcomeName] = useState<string>("");

  /* Quick maps */
  const productByKey = useMemo(() => {
    const map: Record<string, Product> = {};
    for (const p of products) map[p.key] = p;
    return map;
  }, [products]);

  const outletById = useMemo(() => {
    const map: Record<string, Outlet> = {};
    for (const o of outlets) map[o.id] = o;
    return map;
  }, [outlets]);

  // TRIM the outlet name so storage keys match Attendant side exactly
  const selectedOutletName = useMemo<string>(
    () => (outletById[outletId]?.name ?? "").trim(),
    [outletById, outletId]
  );

  /* Pricebook filter helpers */
  const isProductActiveForOutlet = (p: Product, outletName: string): boolean => {
    const row = pricebook[outletName]?.[p.key];
    if (row) return !!row.active;
    return !!p.active; // fallback to global
  };

  /* Load admin data + session (once) */
  useEffect(() => {
    // Outlets (prefer v1 key, fallback to v2)
    const o1 = loadLS<Outlet[]>(K_OUTLETS, []);
    const o2 = o1.length ? o1 : loadLS<Outlet[]>(K_OUTLETS_V2, []);
    setOutlets(o2);

    // Products (prefer v1 key, fallback to v2)
    const p1raw = loadLS<any[]>(K_PRODUCTS, []);
    const p2raw = p1raw.length ? p1raw : loadLS<any[]>(K_PRODUCTS_V2, []);
    // Normalize product fields (sellPrice vs defaultSellPrice)
    const normProducts: Product[] = (p2raw || []).map((p: any) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      unit: (p.unit as Unit) ?? "kg",
      sellPrice: typeof p.sellPrice === "number" ? p.sellPrice : (p.defaultSellPrice ?? 0),
      active: !!p.active,
    }));
    setProducts(normProducts);

    // Pricebook
    const pb = loadLS<typeof pricebook>(K_PRICEBOOK, {});
    setPricebook(pb || {});

    // Welcome
    setWelcomeName(sessionStorage.getItem("supplier_name") || "");
  }, []);

  /* Initialize outlet selection to first active */
  useEffect(() => {
    if (outlets.length > 0 && !outletId) {
      const firstActive = outlets.find(o => o.active) || outlets[0];
      setOutletId(firstActive.id);
    }
  }, [outlets, outletId]);

  /* Load rows + submitted lock + transfers + disputes when date/outlet changes */
  useEffect(() => {
    if (!selectedOutletName) return;

    // Prefer FULL editable rows; if absent, hydrate from minimal opening
    const full = loadLS<SupplyRow[]>(
      supplierOpeningFullKey(dateStr, selectedOutletName),
      []
    );

    if (full.length > 0) {
      setRows(full);
    } else {
      const minimal = loadLS<OpeningItem[]>(
        supplierOpeningKey(dateStr, selectedOutletName),
        []
      );
      const hydrated: SupplyRow[] = minimal.map(mi => {
        const p = productByKey[mi.itemKey];
        return { id: rid(), itemKey: mi.itemKey, qty: mi.qty, buyPrice: 0, unit: p?.unit ?? "kg" };
      });
      setRows(hydrated);
    }

    const isSubmitted = loadLS<boolean>(
      supplierSubmittedKey(dateStr, selectedOutletName),
      false
    );
    setSubmitted(isSubmitted);

    // transfers for date
    const tx = loadLS<TransferRow[]>(supplierTransfersKey(dateStr), []);
    setTransfers(tx);

    // disputes (show open supply disputes for this outlet or all)
    const rawAmends = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
    const list = rawAmends.filter(a => (a.type === "supply" || a.type === "supplier_adjustment") &&
      ((a.outlet && a.outlet === selectedOutletName) || (a.outletName && a.outletName === selectedOutletName)));
    setAmends(list);
  }, [dateStr, selectedOutletName, productByKey]);

  /* ===== Row operations ===== */
  const addRow = (itemKey: string): void => {
    if (!itemKey) return;
    const p = productByKey[itemKey];
    if (!p) return;
    setRows((prev) => [
      ...prev,
      { id: rid(), itemKey, qty: 0, buyPrice: 0, unit: p.unit },
    ]);
  };

  const updateRow = (id: string, patch: Partial<SupplyRow>): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string): void => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /* ===== Save (draft) ===== */
  const saveDraft = (): void => {
    if (!selectedOutletName) return;
    // Save full rows for supplier UI
    saveLS(supplierOpeningFullKey(dateStr, selectedOutletName), rows);
    // Also save minimal (aggregated) for attendants
    const minimal = toMinimal(rows);
    saveLS(supplierOpeningKey(dateStr, selectedOutletName), minimal);
    // Save cost map
    const costMap = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.itemKey] = r.buyPrice || 0;
      return acc;
    }, {});
    saveLS(supplierCostKey(dateStr, selectedOutletName), costMap);
    alert("Saved.");
  };

  /* ===== Submit (lock) ===== */
  const submitDay = (): void => {
    if (!selectedOutletName) return;
    // Save full + minimal + cost
    saveDraft();
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

    const req: AnyAmend = {
      id: rid(),
      date: dateStr,
      outletName: selectedOutletName,
      requestedBy: sessionStorage.getItem("supplier_code") || "supplier",
      type: "supplier_adjustment",
      description: note,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const list = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
    const next = [req, ...list];
    saveLS(AMEND_REQUESTS_KEY, next);
    setAmends(next.filter(a => (a.type === "supply" || a.type === "supplier_adjustment") &&
      ((a.outlet && a.outlet === selectedOutletName) || (a.outletName && a.outletName === selectedOutletName))));
    alert("Modification request sent to Supervisor.");
  };

  /* ===== Add supplier comment on outlet-raised disputes ===== */
  const addAmendComment = (amendId: string) => {
    const text = window.prompt("Add a short comment/reason (visible to Supervisor):", "");
    if (!text) return;
    const code = sessionStorage.getItem("supplier_code") || "supplier";
    const list = loadLS<AnyAmend[]>(AMEND_REQUESTS_KEY, []);
    const next = list.map(a => {
      if (a.id !== amendId) return a;
      const comments = Array.isArray(a.comments) ? a.comments.slice() : [];
      comments.push({ by: code, at: new Date().toISOString(), text });
      return { ...a, comments };
    });
    saveLS(AMEND_REQUESTS_KEY, next);
    setAmends(next.filter(a => (a.type === "supply" || a.type === "supplier_adjustment") &&
      ((a.outlet && a.outlet === selectedOutletName) || (a.outletName && a.outletName === selectedOutletName))));
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
    const fromName = (outletById[txFromId]?.name ?? "").trim();
    const toName = (outletById[txToId]?.name ?? "").trim();
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

    // 2) Adjust FROM outlet (full + minimal)
    adjOutletOpening(fromName, txProductKey, -qtyNum, p.unit);
    // 3) Adjust TO outlet (full + minimal)
    adjOutletOpening(toName, txProductKey, +qtyNum, p.unit);

    alert("Transfer saved and applied to both outlets’ opening.");
    setTxQty("");
  };

  function adjOutletOpening(outletName: string, itemKey: string, delta: number, unit: Unit) {
    // FULL
    const full = loadLS<SupplyRow[]>(supplierOpeningFullKey(dateStr, outletName), []);
    const fullNext = adjustSupplyFull(full, itemKey, delta, unit);
    saveLS(supplierOpeningFullKey(dateStr, outletName), fullNext);

    // MINIMAL
    const minimal = loadLS<OpeningItem[]>(supplierOpeningKey(dateStr, outletName), []);
    const minimalNext = adjustSupplyMinimal(minimal, itemKey, delta);
    saveLS(supplierOpeningKey(dateStr, outletName), minimalNext);
  }

  function adjustSupplyFull(list: SupplyRow[], itemKey: string, delta: number, unit: Unit): SupplyRow[] {
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
  function adjustSupplyMinimal(list: OpeningItem[], itemKey: string, delta: number): OpeningItem[] {
    const idx = list.findIndex((r) => r.itemKey === itemKey);
    if (idx === -1) {
      return [...list, { itemKey, qty: Math.max(0, delta) }];
    } else {
      const next = [...list];
      const now = next[idx];
      const newQty = Math.max(0, now.qty + delta);
      next[idx] = { ...now, qty: newQty };
      return next;
    }
  }

  function toMinimal(list: SupplyRow[]): OpeningItem[] {
    const map = new Map<string, number>();
    for (const r of list) {
      map.set(r.itemKey, (map.get(r.itemKey) || 0) + (r.qty || 0));
    }
    return Array.from(map.entries()).map(([itemKey, qty]) => ({ itemKey, qty }));
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
          <p className="text-sm text-gray-600">
            {welcomeName ? <>Welcome <span className="font-medium">{welcomeName}</span>. </> : null}
            Enter opening supply, manage transfers, and respond to disputes.
          </p>
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
            {products
              .filter((p) => p.active && (!selectedOutletName || isProductActiveForOutlet(p, selectedOutletName)))
              .map((p) => (
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
                    <td className="font-medium">{fmt(line)}</td>
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
                <td className="font-semibold">{fmt(totals.totalBuy)}</td>
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
      <section className="rounded-2xl border p-4 mb-6">
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
                      <td className="p-2">{fmt(t.qty)}</td>
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

      {/* Disputes (read + comment) */}
      <section className="rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Disputes for {selectedOutletName || "—"}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Date</th>
                <th>Type</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Description</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {amends.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-500" colSpan={7}>No disputes.</td>
                </tr>
              ) : amends.map(a => (
                <tr key={a.id} className="border-b">
                  <td className="py-2">{a.date}</td>
                  <td>{a.type || "-"}</td>
                  <td>{a.itemKey || "-"}</td>
                  <td>{typeof a.qty === "number" ? fmt(a.qty) : "-"}</td>
                  <td className="max-w-[28rem] truncate" title={a.description || ""}>{a.description || "-"}</td>
                  <td>{a.status || "-"}</td>
                  <td>
                    <button className="text-xs border rounded-lg px-2 py-1" onClick={() => addAmendComment(a.id)}>
                      Add reason
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          You can add comments/reasons. Only the Supervisor can approve/reject disputes.
        </p>
      </section>

      <footer className="mt-6 text-xs text-gray-600">
        Tip: Complete supplies and transfers <span className="font-medium">before</span> attendants start closing. Use
        “Submit & Lock” when done; contact Supervisor for corrections.
      </footer>
    </main>
  );
}

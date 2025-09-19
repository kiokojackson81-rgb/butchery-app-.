"use client";

import React, { useEffect, useMemo, useState } from "react";

/** ========= Keys used across app ========= */
const AMEND_REQUESTS_KEY = "amend_requests";
const supplierOpeningKey = (date: string, outlet: string) =>
  `supplier_opening_${date}_${outlet}`; // array of rows with at least { itemKey, qty }
const SUP_ADJUST_KEY = (date: string, outlet: string) =>
  `supervisor_adjustments_${date}_${outlet}`; // audit array
const WASTE_REVIEW_KEY = (date: string, outlet: string) =>
  `supervisor_waste_review_${date}_${outlet}`; // per-item decisions map

/** ========= Types (tolerant to mixed shapes already in storage) ========= */
type BaseReq = {
  id: string;
  date: string;                  // "YYYY-MM-DD"
  status: "pending" | "approved" | "rejected";
  requestedBy?: string;
  type: "supply" | "waste" | "expense" | "deficit" | "excess";
  description?: string;
  createdAt?: string;
};

// Some senders store outlet as `outlet`, others as `outletName`
type WithOutlet = { outlet?: string; outletName?: string };

// Attendant supply disputes sometimes include item & qty
type WithItem = { itemKey?: string; qty?: number | string };

/** Row we render (normalized from whatever is in storage) */
type Row = {
  id: string;
  date: string;
  outlet: string;          // normalized outlet name
  requestedBy: string;
  type: BaseReq["type"];
  status: BaseReq["status"];
  description: string;
  itemKey?: string;
  qty?: number;
  raw: any;                // original object (for maximal compatibility)
};

/** ========= Small helpers ========= */
function readJSON<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(k: string, v: any) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}
function ymd() {
  return new Date().toISOString().split("T")[0];
}
function rid() {
  return Math.random().toString(36).slice(2);
}

/** Normalize any stored request into a uniform Row for UI */
function normalizeRequests(list: any[]): Row[] {
  return (list || []).map((r: any): Row => {
    const outlet = (r.outlet ?? r.outletName ?? "").toString();
    const qtyNum =
      typeof r?.qty === "number"
        ? r.qty
        : typeof r?.qty === "string" && r.qty.trim() !== ""
        ? Number(r.qty)
        : undefined;

    return {
      id: r.id ?? rid(),
      date: r.date ?? ymd(),
      outlet,
      requestedBy: r.requestedBy ?? "",
      type: (r.type ?? "supply") as Row["type"],
      status: (r.status ?? "pending") as Row["status"],
      description: r.description ?? "",
      itemKey: r.itemKey ?? undefined,
      qty: qtyNum,
      raw: r,
    };
  });
}

/** Adjust (set) a specific product qty inside supplier opening for date/outlet */
function setOpeningQty(date: string, outlet: string, itemKey: string, nextQty: number) {
  const list = readJSON<any[]>(supplierOpeningKey(date, outlet), []);
  const idx = list.findIndex((x) => x?.itemKey === itemKey);
  if (idx === -1) {
    // Create a minimal row that Attendant understands; keep extra fields if present
    list.push({ id: rid(), itemKey, qty: Math.max(0, nextQty) });
  } else {
    const row = list[idx] || {};
    list[idx] = { ...row, qty: Math.max(0, nextQty) };
  }
  writeJSON(supplierOpeningKey(date, outlet), list);
}

/** Append an audit record for supervisor edits */
function logAdjustment(
  date: string,
  outlet: string,
  who: string,
  itemKey: string,
  prev: number,
  next: number,
  note?: string
) {
  const key = SUP_ADJUST_KEY(date, outlet);
  const arr = readJSON<any[]>(key, []);
  arr.unshift({
    id: rid(),
    when: new Date().toISOString(),
    who,
    kind: "supply",
    itemKey,
    prev,
    next,
    note: note || "",
  });
  writeJSON(key, arr);
}

/** Mark waste review status for a specific item if outlet/date available */
function setWasteReview(
  date: string,
  outlet: string,
  itemKey: string,
  status: "approved" | "rejected",
  reviewer: string,
  reason?: string
) {
  const key = WASTE_REVIEW_KEY(date, outlet);
  const map = readJSON<Record<string, any>>(key, {});
  map[itemKey] = {
    status,
    reason: reason || "",
    reviewer,
    reviewedAt: new Date().toISOString(),
  };
  writeJSON(key, map);
}

/** Try to extract a product key from a free-text description like "[Beef] qty=2kg" */
function parseItemKeyFromDescription(desc: string): string | undefined {
  const m = desc?.match(/\[([^\]]+)\]/); // text inside [...]
  if (m && m[1]) return m[1].trim().toLowerCase().replace(/\s+/g, "_"); // e.g., "Beef" -> "beef"
  return undefined;
}

/** ========= Component ========= */
export default function SupervisorDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<{
    status: "all" | "pending" | "approved" | "rejected";
    type: "all" | Row["type"];
    date: string;
  }>({ status: "pending", type: "all", date: ymd() });

  /** Load from localStorage on mount */
  useEffect(() => {
    const list = readJSON<any[]>(AMEND_REQUESTS_KEY, []);
    setRows(normalizeRequests(list));
  }, []);

  /** Persist helper */
  const persist = (nextRows: Row[]) => {
    setRows(nextRows);
    // write back original raw objects, with updated status
    const raw = readJSON<any[]>(AMEND_REQUESTS_KEY, []);
    const byId = new Map(nextRows.map((r) => [r.id, r.status]));
    const merged = (raw || []).map((r: any) => {
      const id = r.id ?? "";
      if (byId.has(id)) return { ...r, status: byId.get(id) };
      return r;
    });
    writeJSON(AMEND_REQUESTS_KEY, merged);
  };

  /** Approve/Reject */
  const decide = (row: Row, decision: "approved" | "rejected") => {
    // 1) Update request status in storage
    const next = rows.map((r) => (r.id === row.id ? { ...r, status: decision } : r));
    persist(next);

    // 2) Apply side-effects when we have enough info (non-breaking)
    const outlet = row.outlet;
    const date = row.date;
    const reviewer = "supervisor"; // could later read from session code/name

    if (row.type === "supply" && decision === "approved" && outlet && date) {
      // If we know the item, ask for corrected qty; then apply
      const itemKey =
        row.itemKey ||
        parseItemKeyFromDescription(row.description || "") ||
        undefined;

      if (itemKey) {
        const curList = readJSON<any[]>(supplierOpeningKey(date, outlet), []);
        const current = (curList.find((x) => x?.itemKey === itemKey)?.qty ?? 0) as number;

        const input = window.prompt(
          `Enter corrected opening qty for ${itemKey} at ${outlet} (${date}). Current: ${current}`,
          String(current)
        );

        if (input !== null) {
          const nextQty = Number(input);
          if (!Number.isNaN(nextQty) && nextQty >= 0) {
            setOpeningQty(date, outlet, itemKey, nextQty);
            logAdjustment(
              date,
              outlet,
              reviewer,
              itemKey,
              Number(current) || 0,
              nextQty,
              `Approved dispute: ${row.description || ""}`
            );
            alert("Opening updated and adjustment logged ✅");
          }
        }
      }
    }

    if (row.type === "waste" && outlet && date) {
      // If itemKey known, record decision to waste review map
      const itemKey =
        row.itemKey ||
        parseItemKeyFromDescription(row.description || "") ||
        undefined;
      if (itemKey) {
        const reason =
          decision === "rejected"
            ? window.prompt("Reason for rejecting this waste?", "") || ""
            : "";
        setWasteReview(date, outlet, itemKey, decision === "approved" ? "approved" : "rejected", reviewer, reason);
      }
    }

    alert(`Request ${decision.toUpperCase()} ✅`);
  };

  /** Filters */
  const shown = useMemo(() => {
    return rows.filter((r) => {
      if (filter.status !== "all" && r.status !== filter.status) return false;
      if (filter.type !== "all" && r.type !== filter.type) return false;
      if (filter.date && r.date !== filter.date) return false;
      return true;
    });
  }, [rows, filter]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Supervisor Dashboard</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="text-xs text-gray-600">Date</label>
        <input
          className="border rounded-xl p-2 text-sm"
          type="date"
          value={filter.date}
          onChange={(e) => setFilter((f) => ({ ...f, date: e.target.value }))}
        />
        <label className="text-xs text-gray-600 ml-2">Status</label>
        <select
          className="border rounded-xl p-2 text-sm"
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as any }))}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <label className="text-xs text-gray-600 ml-2">Type</label>
        <select
          className="border rounded-xl p-2 text-sm"
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value as any }))}
        >
          <option value="all">All</option>
          <option value="supply">Supply</option>
          <option value="waste">Waste</option>
          <option value="expense">Expense</option>
          <option value="deficit">Deficit</option>
          <option value="excess">Excess</option>
        </select>
      </div>

      {/* Requests table */}
      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-medium mb-3">Amendment Requests</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Date</th>
                <th className="p-2">Outlet</th>
                <th className="p-2">Requested By</th>
                <th className="p-2">Type</th>
                <th className="p-2">Item</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Description</th>
                <th className="p-2">Status</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={9}>
                    No requests match your filters.
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.outlet || "—"}</td>
                    <td className="p-2">{r.requestedBy || "—"}</td>
                    <td className="p-2 capitalize">{r.type}</td>
                    <td className="p-2">{r.itemKey || "—"}</td>
                    <td className="p-2">{r.qty ?? "—"}</td>
                    <td className="p-2">{r.description || "—"}</td>
                    <td className="p-2">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          r.status === "pending"
                            ? "bg-yellow-200 text-yellow-800"
                            : r.status === "approved"
                            ? "bg-green-200 text-green-800"
                            : "bg-red-200 text-red-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2">
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            className="border rounded-lg px-2 py-1 text-xs bg-green-100"
                            onClick={() => decide(r, "approved")}
                          >
                            Approve
                          </button>
                          <button
                            className="border rounded-lg px-2 py-1 text-xs bg-red-100"
                            onClick={() => decide(r, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

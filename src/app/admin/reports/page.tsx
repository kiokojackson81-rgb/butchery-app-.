"use client";

import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* =========================
   Keys (match your app)
   ========================= */
const supplierOpeningKey = (date: string, outlet: string) => `supplier_opening_${date}_${outlet}`;
const attClosingKey      = (date: string, outlet: string) => `attendant_closing_${date}_${outlet}`;
const attWasteKey        = (date: string, outlet: string) => `attendant_waste_${date}_${outlet}`;
const depositKey         = (date: string, outlet: string) => `attendant_deposit_${date}_${outlet}`; // legacy total or {amount}
const expensesKey        = (date: string, outlet: string) => `attendant_expenses_${date}_${outlet}`; // [{name,amount}]
const attSummaryKey      = (date: string, outlet: string) => `attendant_summary_${date}_${outlet}`;  // {expectedKsh,depositedKsh,expensesKsh,cashAtTill,varianceKsh}
const ADMIN_PRODUCTS_KEY = "admin_products";
const ADMIN_STAFF_KEY    = "admin_staff";

/* =========================
   Types / helpers
   ========================= */
type Unit = "kg" | "pcs";
type AdminProduct = { key: string; name: string; unit: Unit; sellPrice: number; active: boolean; };
type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";
const OUTLETS: Outlet[] = ["Bright", "Baraka A", "Baraka B", "Baraka C"];

// Staff + scope
type Staff = { id: string; name: string; code: string; outlet: Outlet; products: string[]; active: boolean };
type Grain = "daily" | "weekly" | "monthly";
type ScopeType = "ALL" | "OUTLET" | "STAFF";

const toNum = (v: any) => (typeof v === "number" ? v : v ? Number(v) : 0);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const ymd = (d: Date) => d.toISOString().split("T")[0];
const addDays = (d: Date, delta: number) => { const x = new Date(d); x.setDate(x.getDate() + delta); return x; };

const bucketKey = (dateStr: string, g: Grain) => {
  if (g === "daily") return dateStr;
  const d = new Date(dateStr + "T00:00:00");
  if (g === "weekly") {
    const day = d.getDay() || 7; // Mon=1..Sun=7
    const monday = addDays(d, 1 - day);
    const sunday = addDays(monday, 6);
    return `${ymd(monday)}..${ymd(sunday)}`;
  }
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}`;
};

/* Safe readers (normalize any old/bad shapes to expected) */
function readOpeningRows(date: string, outlet: string): Array<{ itemKey: string; qty: number; buyPrice?: number; assignedTo?: string }> {
  try {
    const raw = localStorage.getItem(supplierOpeningKey(date, outlet));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
    if (parsed && typeof parsed === "object") {
      const vals = Object.values(parsed);
      if (Array.isArray(vals) && vals.every(v => v && typeof v === "object")) return vals as any[];
    }
    return [];
  } catch { return []; }
}
function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch { return {}; }
}
function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/* =========================
   Page
   ========================= */
export default function AdminReportsPage() {
  const [start, setStart] = useState(() => ymd(new Date()));
  const [end, setEnd] = useState(() => ymd(new Date()));
  const [grain, setGrain] = useState<Grain>("daily");

  // NEW scope controls
  const [scopeType, setScopeType] = useState<ScopeType>("ALL");
  const [scopeOutlet, setScopeOutlet] = useState<Outlet>("Bright");
  const [scopeStaffCode, setScopeStaffCode] = useState<string>("");

  // which sub-report to show
  const [tab, setTab] = useState<"summary" | "items" | "waste">("summary");

  // prices & units
  const [products, setProducts] = useState<AdminProduct[]>([]);
  useEffect(() => {
    try { const raw = localStorage.getItem(ADMIN_PRODUCTS_KEY); if (raw) setProducts(JSON.parse(raw)); } catch {}
  }, []);
  const price = useMemo(() => {
    const m: Record<string, { unit: Unit; sellPrice: number; name: string }> = {};
    products.forEach(p => { if (p.active) m[p.key] = { unit: p.unit, sellPrice: toNum(p.sellPrice), name: p.name }; });
    return m;
  }, [products]);

  // staff list
  const [staffList, setStaffList] = useState<Staff[]>([]);
  useEffect(() => {
    try { const raw = localStorage.getItem(ADMIN_STAFF_KEY); setStaffList(raw ? JSON.parse(raw) : []); } catch { setStaffList([]); }
  }, []);
  const findStaff = (code: string) => staffList.find((s) => s.active && s.code === code);
  const staffLabel = (s?: Staff) => (s ? `${s.name} (${s.code}) — ${s.outlet}` : "");

  // date list
  const dates = useMemo(() => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    const arr: string[] = [];
    for (let d = new Date(s); d <= e; d = addDays(d, 1)) arr.push(ymd(d));
    return arr;
  }, [start, end]);

  // crunch
  const data = useMemo(() => {
    type SummaryRow = {
      bucket: string; outlet: Outlet | "ALL";
      expectedKsh: number; depositsKsh: number; expensesKsh: number;
      tillProjectedKsh: number; // expected - deposits - expenses
      varianceKsh: number;      // counted - projected (0 if unknown)
      notYetDepositedKsh: number; // same as tillProjectedKsh (projected)
      deficitKsh: number;       // negative variance only
    };
    type ItemRow = { bucket: string; outlet: Outlet | "ALL"; item: string; soldQty: number; unit: Unit; sellValueKsh: number; };
    type WasteRow = { bucket: string; outlet: Outlet | "ALL"; item: string; wasteQty: number; unit: Unit; wasteValueKsh: number; };

    const sumByKey = <T extends Record<string, any>>(rows: T[], groupKeys: (keyof T)[], numeric: (keyof T)[]) => {
      const map = new Map<string, T>();
      const keyOf = (r: T) => groupKeys.map(k => String(r[k])).join("|");
      for (const r of rows) {
        const k = keyOf(r);
        if (!map.has(k)) map.set(k, { ...r });
        else {
          const acc = map.get(k)!;
          numeric.forEach(n => { acc[n] = toNum(acc[n]) + toNum(r[n]); });
        }
      }
      return Array.from(map.values());
    };

    // Determine scope
    let wantedOutlets: Outlet[] = [...OUTLETS];
    let staffFilter: { code?: string; outlet?: Outlet } | null = null;
    if (scopeType === "OUTLET") wantedOutlets = [scopeOutlet];
    if (scopeType === "STAFF" && scopeStaffCode) {
      const st = staffList.find((s) => s.active && s.code === scopeStaffCode);
      if (st) { wantedOutlets = [st.outlet]; staffFilter = { code: st.code, outlet: st.outlet }; }
      else { wantedOutlets = []; }
    }

    // raw accumulation
    const summary: SummaryRow[] = [];
    const items: ItemRow[] = [];
    const wastes: WasteRow[] = [];

    for (const date of dates) {
      const bucket = bucketKey(date, grain);

      for (const o of wantedOutlets) {
        const opening = readOpeningRows(date, o);
        const closing = readMap(attClosingKey(date, o));
        const waste   = readMap(attWasteKey(date, o));

        // deposits (legacy)
        let depositsKsh = 0;
        try {
          const depRaw = localStorage.getItem(depositKey(date, o));
          if (depRaw) {
            const dep = JSON.parse(depRaw);
            depositsKsh = typeof dep === "number" ? dep : toNum(dep.amount);
          }
        } catch {}

        // expenses
        const exps = readList<{ name: string; amount: number }>(expensesKey(date, o));
        let expensesKsh = exps.reduce((a, e) => a + toNum(e.amount), 0);

        // saved summary (preferred)
        const saved = (() => {
          try { const raw = localStorage.getItem(attSummaryKey(date, o)); return raw ? JSON.parse(raw) : null; }
          catch { return null; }
        })();

        // apply STAFF scope filtering if needed
        let openingFiltered = opening as any[];
        let closingFiltered: Record<string, number> = closing;
        let wasteFiltered: Record<string, number> = waste;
        if (scopeType === "STAFF" && staffFilter?.code) {
          const hasAssign = Array.isArray(openingFiltered) && openingFiltered.some((r) => r?.assignedTo);
          if (hasAssign) {
            const assignedRows = openingFiltered.filter((r) => r.assignedTo === staffFilter!.code);
            const keys = new Set(assignedRows.map((r) => r.itemKey));
            openingFiltered = assignedRows;
            closingFiltered = Object.fromEntries(Object.entries(closing).filter(([k]) => keys.has(k)));
            wasteFiltered   = Object.fromEntries(Object.entries(waste).filter(([k]) => keys.has(k)));
          } else {
            const st = staffList.find((s) => s.code === staffFilter!.code);
            const keys = new Set((st?.products || []) as string[]);
            openingFiltered = openingFiltered.filter((r) => keys.has(r.itemKey));
            closingFiltered = Object.fromEntries(Object.entries(closing).filter(([k]) => keys.has(k)));
            wasteFiltered   = Object.fromEntries(Object.entries(waste).filter(([k]) => keys.has(k)));
          }
        }

        let expectedKsh = 0, tillProjectedKsh = 0, varianceKsh = 0;

        // sold per item using filtered data
        const supplied: Record<string, number> = {};
        (openingFiltered as any[]).forEach(r => { supplied[r.itemKey] = (supplied[r.itemKey] || 0) + toNum(r.qty); });
        const soldByItem: Record<string, number> = {};
        const wasteByItem: Record<string, number> = {};

        Object.keys({ ...supplied, ...closingFiltered, ...wasteFiltered }).forEach(k => {
          const open = toNum(supplied[k] || 0);
          const close = toNum((closingFiltered as any)[k] || 0);
          const w = toNum((wasteFiltered as any)[k] || 0);
          const sold = Math.max(0, open - close - w);
          soldByItem[k] = sold;
          wasteByItem[k] = w;
        });

        if (saved && scopeType !== "STAFF") { // only use outlet-level saved summary when not in staff scope
          expectedKsh      = toNum(saved.expectedKsh);
          tillProjectedKsh = toNum(saved.cashAtTill);
          varianceKsh      = toNum(saved.varianceKsh);
          if (typeof saved.depositedKsh === "number") depositsKsh = toNum(saved.depositedKsh);
          if (typeof saved.expensesKsh === "number") expensesKsh = Math.max(expensesKsh, toNum(saved.expensesKsh));
        } else {
          expectedKsh = Object.entries(soldByItem).reduce((sum, [k, q]) => sum + toNum(q) * toNum(price[k]?.sellPrice || 0), 0);
          tillProjectedKsh = expectedKsh - depositsKsh - expensesKsh;
          varianceKsh = 0; // unknown without counted till
        }

        // rows:
        summary.push({
          bucket,
          outlet: o,
          expectedKsh,
          depositsKsh,
          expensesKsh,
          tillProjectedKsh,
          varianceKsh,
          notYetDepositedKsh: tillProjectedKsh,
          deficitKsh: Math.max(0, -varianceKsh),
        });

        Object.keys(soldByItem).forEach(k => {
          const q = toNum(soldByItem[k]);
          items.push({ bucket, outlet: o, item: price[k]?.name || k, soldQty: q, unit: (price[k]?.unit || "kg") as Unit, sellValueKsh: q * toNum(price[k]?.sellPrice || 0) });
        });

        Object.keys(wasteByItem).forEach(k => {
          const q = toNum(wasteByItem[k]);
          wastes.push({ bucket, outlet: o, item: price[k]?.name || k, wasteQty: q, unit: (price[k]?.unit || "kg") as Unit, wasteValueKsh: q * toNum(price[k]?.sellPrice || 0) });
        });
      }

      // also push "ALL" combined for this bucket when scope = ALL
      if (scopeType === "ALL") {
        const rowsThisBucket = summary.filter(r => r.bucket === bucket);
        const allCombined = rowsThisBucket.reduce((acc, r) => {
          acc.expectedKsh      += r.expectedKsh;
          acc.depositsKsh      += r.depositsKsh;
          acc.expensesKsh      += r.expensesKsh;
          acc.tillProjectedKsh += r.tillProjectedKsh;
          acc.varianceKsh      += r.varianceKsh;
          return acc;
        }, { expectedKsh:0, depositsKsh:0, expensesKsh:0, tillProjectedKsh:0, varianceKsh:0 });

        summary.push({
          bucket,
          outlet: "ALL",
          expectedKsh: allCombined.expectedKsh,
          depositsKsh: allCombined.depositsKsh,
          expensesKsh: allCombined.expensesKsh,
          tillProjectedKsh: allCombined.tillProjectedKsh,
          varianceKsh: allCombined.varianceKsh,
          notYetDepositedKsh: allCombined.tillProjectedKsh,
          deficitKsh: Math.max(0, -allCombined.varianceKsh),
        });

        const group = <T extends Record<string, any>>(rows: T[], keys: (keyof T)[], nums: (keyof T)[]) => {
          const m = new Map<string, T>(); const keyOf = (r: T) => keys.map(k => String(r[k])).join("|");
          for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, { ...r }); else { const acc = m.get(k)!; nums.forEach(n => acc[n] = toNum(acc[n]) + toNum(r[n])); } }
          return Array.from(m.values());
        };

        const itemsAll = group(items.filter(r => r.bucket === bucket), ["bucket","item","unit"], ["soldQty","sellValueKsh"]).map(r => ({ ...r, outlet: "ALL" as const }));
        items.push(...itemsAll);

        const wasteAll = group(wastes.filter(r => r.bucket === bucket), ["bucket","item","unit"], ["wasteQty","wasteValueKsh"]).map(r => ({ ...r, outlet: "ALL" as const }));
        wastes.push(...wasteAll);
      }
    }

    // Sort nicely
    const by = (k: string) => (a: any, b: any) => String(a[k]).localeCompare(String(b[k]));
    summary.sort((a,b)=> by("bucket")(a,b) || by("outlet")(a,b));
    items.sort((a,b)=> by("bucket")(a,b) || by("outlet")(a,b) || by("item")(a,b));
    wastes.sort((a,b)=> by("bucket")(a,b) || by("outlet")(a,b) || by("item")(a,b));

    return { summary, items, wastes };
  }, [dates, grain, scopeType, scopeOutlet, scopeStaffCode, price, products, staffList]);

  // Table rows for each tab (for UI display + PDF)
  const summaryRows = useMemo(() => data.summary.map(r => ({
    Period: r.bucket,
    Outlet: r.outlet,
    "Total Sales (Ksh)": fmt(r.expectedKsh),
    "Deposits (Ksh)": fmt(r.depositsKsh),
    "Expenses (Ksh)": fmt(r.expensesKsh),
    "Amount in Till (Projected)": fmt(r.tillProjectedKsh),
    "Not Yet Deposited (Ksh)": fmt(r.notYetDepositedKsh),
    "Deficit (Ksh)": fmt(r.deficitKsh),
  })), [data.summary]);

  const itemRows = useMemo(() => data.items.map(r => ({
    Period: r.bucket,
    Outlet: r.outlet,
    Item: r.item,
    "Sold (kg/pcs)": r.soldQty,
    Unit: r.unit,
    "Sell Value (Ksh)": fmt(r.sellValueKsh),
  })), [data.items]);

  const wasteRows = useMemo(() => data.wastes.map(r => ({
    Period: r.bucket,
    Outlet: r.outlet,
    Item: r.item,
    "Waste (kg/pcs)": r.wasteQty,
    Unit: r.unit,
    "Waste Value (Ksh)": fmt(r.wasteValueKsh),
  })), [data.wastes]);

  // KPIs on current scope/date range (combined)
  const kpis = useMemo(() => {
    const s = data.summary.filter((r) => {
      if (scopeType === "ALL") return r.outlet === "ALL";
      if (scopeType === "OUTLET") return r.outlet === scopeOutlet;
      if (scopeType === "STAFF") return r.outlet === (findStaff(scopeStaffCode)?.outlet || "Bright");
      return false;
    });
    const totalSales  = s.reduce((a,r)=>a+r.expectedKsh,0);
    const deposits    = s.reduce((a,r)=>a+r.depositsKsh,0);
    const expenses    = s.reduce((a,r)=>a+r.expensesKsh,0);
    const till        = s.reduce((a,r)=>a+r.tillProjectedKsh,0);
    const notDepos    = s.reduce((a,r)=>a+r.notYetDepositedKsh,0);
    const deficit     = s.reduce((a,r)=>a+r.deficitKsh,0);
    const wasteValue  = data.wastes
      .filter((w) => {
        if (scopeType === "ALL") return w.outlet === "ALL";
        if (scopeType === "OUTLET") return w.outlet === scopeOutlet;
        if (scopeType === "STAFF") return w.outlet === (findStaff(scopeStaffCode)?.outlet || "Bright");
        return false;
      })
      .reduce((a,w)=>a+w.wasteValueKsh,0);
    return { totalSales, deposits, expenses, till, notDepos, deficit, wasteValue };
  }, [data.summary, data.wastes, scopeType, scopeOutlet, scopeStaffCode]);

  /* -------- PDF Export -------- */
  function exportPDF(kind: "summary" | "items" | "waste") {
    const map = {
      summary: { title: "Sales Summary", rows: summaryRows },
      items:   { title: "Item Sales (kg/pcs)", rows: itemRows },
      waste:   { title: "Waste", rows: wasteRows },
    }[kind];

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    // Header
    doc.setFontSize(14);
    doc.text(`Baraka Butchery — ${map.title}`, 40, 40);
    const scopeLine =
      scopeType === "ALL"
        ? "Scope: ALL outlets"
        : scopeType === "OUTLET"
        ? `Scope: Outlet = ${scopeOutlet}`
        : `Scope: Staff = ${staffLabel(findStaff(scopeStaffCode)) || scopeStaffCode || "—"}`;
    doc.setFontSize(10);
    doc.text(`Range: ${start} → ${end}   •   Grain: ${grain.toUpperCase()}   •   ${scopeLine}`, 40, 58);

    // KPIs
    if (kind === "summary") {
      doc.setFontSize(11);
      doc.text(
        `TOTAL Sales: Ksh ${fmt(kpis.totalSales)}   |   Deposits: Ksh ${fmt(kpis.deposits)}   |   Expenses: Ksh ${fmt(kpis.expenses)}   |   Till (Projected): Ksh ${fmt(kpis.till)}   |   Not Deposited: Ksh ${fmt(kpis.notDepos)}   |   Deficit: Ksh ${fmt(kpis.deficit)}`,
        40, 78,
      );
    } else if (kind === "waste") {
      doc.setFontSize(11);
      doc.text(`Total Waste Value (Ksh): ${fmt(kpis.wasteValue)}`, 40, 78);
    }

    // Table
    const headers = map.rows[0] ? Object.keys(map.rows[0]) : [];
    const body = map.rows.map(r => headers.map(h => (r as any)[h]));

    autoTable(doc, {
      startY: 95,
      head: [headers],
      body,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 30, 30] },
      margin: { left: 40, right: 40 },
    });

    doc.save(`${map.title.replace(/\s+/g, "_")}_${start}_${end}_${grain}_${scopeType === "OUTLET" ? scopeOutlet : scopeType === "STAFF" ? scopeStaffCode : "ALL"}.pdf`);
  }

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Admin • Reports (PDF + Staff scope)</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm">From</label>
          <input className="border rounded-xl p-2 text-sm" type="date" value={start} onChange={e=>setStart(e.target.value)} />
          <label className="text-sm">To</label>
          <input className="border rounded-xl p-2 text-sm" type="date" value={end} onChange={e=>setEnd(e.target.value)} />
          <select className="border rounded-xl p-2 text-sm" value={grain} onChange={e=>setGrain(e.target.value as Grain)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          {/* Scope pickers */}
          <select className="border rounded-xl p-2 text-sm" value={scopeType} onChange={(e)=>setScopeType(e.target.value as ScopeType)}>
            <option value="ALL">All Outlets (combined)</option>
            <option value="OUTLET">Specific Outlet</option>
            <option value="STAFF">Specific Staff</option>
          </select>

          {scopeType === "OUTLET" && (
            <select className="border rounded-xl p-2 text-sm" value={scopeOutlet} onChange={(e)=>setScopeOutlet(e.target.value as Outlet)}>
              {OUTLETS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {scopeType === "STAFF" && (
            <select className="border rounded-xl p-2 text-sm" value={scopeStaffCode} onChange={(e)=>setScopeStaffCode(e.target.value)}>
              <option value="">— Select Staff —</option>
              {staffList.filter(s=>s.active).map(s => (
                <option key={s.code} value={s.code}>{s.name} ({s.code}) — {s.outlet}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* KPIs */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <KPI title="Total Sales (Ksh)" value={`Ksh ${fmt(kpis.totalSales)}`} />
        <KPI title="Deposited (Ksh)"  value={`Ksh ${fmt(kpis.deposits)}`} />
        <KPI title="Expenses (Ksh)"   value={`Ksh ${fmt(kpis.expenses)}`} />
        <KPI title="Till (Projected)"  value={`Ksh ${fmt(kpis.till)}`} />
        <KPI title="Not Deposited"     value={`Ksh ${fmt(kpis.notDepos)}`} />
        <KPI title="Deficit"           value={`Ksh ${fmt(kpis.deficit)}`} />
      </section>

      {/* Tabs */}
      <nav className="mb-3 flex gap-2">
        <TabBtn onClick={()=>setTab("summary")} active={tab==="summary"}>Sales Summary</TabBtn>
        <TabBtn onClick={()=>setTab("items")}   active={tab==="items"}>Item Sales (kg/pcs)</TabBtn>
        <TabBtn onClick={()=>setTab("waste")}   active={tab==="waste"}>Waste</TabBtn>
      </nav>

      {tab === "summary" && (
        <ReportSection
          title="Sales Summary"
          description="Total sales, deposits, expenses, projected till (not yet deposited), and deficit."
          rows={summaryRows}
          onPdf={()=>exportPDF("summary")}
        />
      )}

      {tab === "items" && (
        <ReportSection
          title="Item Sales (kg/pcs)"
          description="How many kg/pcs were sold per item and their sell value."
          rows={itemRows}
          onPdf={()=>exportPDF("items")}
        />
      )}

      {tab === "waste" && (
        <ReportSection
          title="Waste"
          description="Waste quantity per item and total waste value (valued at sell price)."
          rows={wasteRows}
          onPdf={()=>exportPDF("waste")}
        />
      )}
    </main>
  );
}

/* =========== UI bits =========== */
function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border p-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-xl border text-sm ${active ? "bg-black text-white" : "bg-white"}`}>
      {children}
    </button>
  );
}
function ReportSection({ title, description, rows, onPdf }:{ title: string; description: string; rows: any[]; onPdf: () => void; }) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <section className="rounded-2xl border p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-gray-600">{description}</p>
        </div>
        <button className="border rounded-xl px-3 py-2 text-sm" onClick={onPdf}>Download PDF</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b">
              {headers.map(h => <th key={h} className="py-2">{h}</th>)}
            </tr>
          </thead>
        </table>
        <div className="text-xs text-gray-600 p-2">
          {rows.length === 0 ? "No data for the selected filters." : `${rows.length} rows – use Download PDF to export full table.`}
        </div>
      </div>
    </section>
  );
}

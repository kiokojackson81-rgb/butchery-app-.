// src/app/api/performance/pdf/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function today(): string { return new Date().toISOString().slice(0,10); }

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let from = String(searchParams.get("from") || "").slice(0,10);
    let to = String(searchParams.get("to") || "").slice(0,10);
    let date = String(searchParams.get("date") || "").slice(0,10);
    const outlet = String(searchParams.get("outlet") || "").trim();
    const product = String(searchParams.get("product") || "").trim();

    // Defaults: if no range provided, use single-day today
    if (!from && !to && !date) {
      date = today();
      from = date;
      to = date;
    } else if (!from && !to && date) {
      from = date; to = date;
    }

    // Fetch data similar to /api/performance/* and /api/intervals/list
    const whereOutlet: any = {};
    if (from || to) whereOutlet.date = { gte: from || undefined, lte: to || undefined };
    if (outlet) whereOutlet.outletName = outlet;
    const outlets = await (prisma as any).outletPerformance.findMany({ where: whereOutlet, orderBy: [{ date: "asc" }, { outletName: "asc" }] });

    const whereAtt: any = {};
    if (from || to) whereAtt.date = { gte: from || undefined, lte: to || undefined };
    if (outlet) whereAtt.outletName = outlet;
    const attendants = await (prisma as any).attendantKPI.findMany({ where: whereAtt, orderBy: [{ date: "asc" }, { outletName: "asc" }] });

    let waste: Array<{ outletName: string; productKey: string; wasteQty: number; wasteValue: number }> = [];
    if (date) {
      const whereW: any = { date };
      if (outlet) whereW.outletName = outlet;
      const [rows, pb] = await Promise.all([
        (prisma as any).attendantClosing.findMany({ where: whereW }),
        outlet ? (prisma as any).pricebookRow.findMany({ where: { outletName: outlet } }) : Promise.resolve([]),
      ]);
      const priceByKey = new Map<string, number>((pb || []).map((r: any) => [r.productKey, Number(r.sellPrice || 0)]));
      const agg = new Map<string, { outletName: string; productKey: string; wasteQty: number; wasteValue: number }>();
      for (const r of rows || []) {
        const k = String((r as any).itemKey);
        const o = String((r as any).outletName);
        const key = `${o}::${k}`;
        const price = priceByKey.get(k) || 0;
        const wasteQty = Number((r as any).wasteQty || 0);
        const cur = agg.get(key) || { outletName: o, productKey: k, wasteQty: 0, wasteValue: 0 };
        cur.wasteQty += wasteQty;
        cur.wasteValue += wasteQty * price;
        agg.set(key, cur);
      }
      waste = Array.from(agg.values());
    }

    const whereInt: any = {};
    if (outlet) whereInt.outletName = outlet;
    if (product) whereInt.productKey = product;
    let intervals: any[] = [];
    try {
      intervals = await (prisma as any).supplyIntervalPerformance.findMany({ where: whereInt, orderBy: [{ outletName: "asc" }, { productKey: "asc" }, { startedAt: "asc" }] });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (/does not exist/i.test(msg) && /SupplyIntervalPerformance/i.test(msg)) {
        intervals = [];
      } else {
        throw err;
      }
    }

    // Build PDF
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const title = `Performance Report${outlet? ` — ${outlet}`:""}`;
    doc.setFontSize(16);
    doc.text(title, 40, 40);
    const sub = `Range: ${from || "?"} → ${to || "?"}${date? ` · Waste: ${date}`:""}`;
    doc.setFontSize(10);
    doc.text(sub, 40, 58);

    let y = 80;
    // Outlets section
    autoTable(doc, {
      startY: y,
      head: [["Date","Outlet","Sales","Expenses","NP","Deposits","Expected","Deficit","Waste"]],
      body: (outlets || []).map((r: any) => [
        r.date,
        r.outletName,
        Math.round(Number(r.totalSales||0)),
        Math.round(Number(r.expenses||0)),
        Math.round(Number(r.netProfit||0)),
        Math.round(Number(r.deposits||0)),
        Math.round(Number(r.expectedDeposit||0)),
        Math.round(Number(r.deficit||0)),
        Math.round(Number(r.wasteCost||0)),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30,30,30] },
      theme: "grid",
      margin: { left: 40, right: 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 24;

    // Attendants section
    autoTable(doc, {
      startY: y,
      head: [["Date","Outlet","Sales","NP","Salary/day","ROI x","Deposit Gap","Flags"]],
      body: (attendants || []).map((r: any) => [
        r.date,
        r.outletName,
        Math.round(Number(r.sales||0)),
        Math.round(Number(r.np||0)),
        Math.round(Number(r.salaryDay||0)),
        Number(r.roiVsSalary||0).toFixed(2),
        Math.round(Number(r.depositGap||0)),
        Array.isArray(r.redFlags) && r.redFlags.length ? String(r.redFlags.join(", ")) : "—",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30,30,30] },
      theme: "grid",
      margin: { left: 40, right: 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 24;

    // Waste section (if date provided)
    if (date) {
      autoTable(doc, {
        startY: y,
        head: [[`Waste — ${date}`,"Product","Waste Qty","Waste Value"]],
        body: (waste || []).map((r: any) => [
          r.outletName,
          r.productKey,
          Number(r.wasteQty||0).toFixed(2),
          Math.round(Number(r.wasteValue||0)),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30,30,30] },
        theme: "grid",
        margin: { left: 40, right: 40 },
      });
      y = (doc as any).lastAutoTable.finalY + 24;
    }

    // Intervals section
    autoTable(doc, {
      startY: y,
      head: [["Outlet","Product","Start","End","Sales Qty","Waste Qty","Revenue","GP","GP%","Deposit Gap"]],
      body: (intervals || []).map((r: any) => [
        r.outletName,
        r.productKey,
        new Date(r.startedAt).toISOString().slice(0,19).replace('T',' '),
        r.endedAt ? new Date(r.endedAt).toISOString().slice(0,19).replace('T',' ') : '—',
        Number(r.salesQty||0).toFixed(2),
        Number(r.wasteQty||0).toFixed(2),
        Math.round(Number(r.revenue||0)),
        Math.round(Number(r.grossProfit||0)),
        Number(r.gpPct||0).toFixed(2),
        Math.round(Number(r.depositGap||0)),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30,30,30] },
      theme: "grid",
      margin: { left: 40, right: 40 },
    });

    const pdfArray = doc.output("arraybuffer") as ArrayBuffer;
    const buf = Buffer.from(pdfArray as any);
    const fname = `performance_${from || today()}_to_${to || from || today()}${outlet? `_${outlet}`:""}.pdf`;
    return new Response(buf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fname}"` } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

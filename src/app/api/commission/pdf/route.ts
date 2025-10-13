import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { getCommissionPeriodFor } from "@/server/commission";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function num(n: any): number { const v = Number(n); return isFinite(v) ? v : 0; }

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || new Date().toISOString().slice(0,10)).slice(0,10);
    const outlet = (searchParams.get("outlet") || "").trim();
  const supCode = (searchParams.get("supervisor") || "").trim() || undefined;
  const status = (searchParams.get("status") || "").trim() || undefined;
  const idsRaw = (searchParams.get("ids") || "").trim();
  const ids = idsRaw ? idsRaw.split(",").map(s=>s.trim()).filter(Boolean) : [];
  const { start, end, key } = getCommissionPeriodFor(date);
  const where: any = { periodKey: key, ...(outlet ? { outletName: outlet } : {}), ...(supCode ? { supervisorCode: supCode } : {}), ...(status ? { status } : {}), ...(ids.length ? { id: { in: ids } } : {}) };
    const rows: any[] = await (prisma as any).supervisorCommission.findMany({ where, orderBy: [{ date: "asc" }, { outletName: "asc" }] });

    // Aggregate totals
    const totals = rows.reduce((a, r) => {
      a.sales += num(r.salesKsh); a.expenses += num(r.expensesKsh); a.waste += num(r.wasteKsh); a.profit += num(r.profitKsh); a.comm += num(r.commissionKsh);
      return a;
    }, { sales: 0, expenses: 0, waste: 0, profit: 0, comm: 0 });

    // Create PDF
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const title = `Supervisor Commissions (${start} → ${end})`;
    doc.setFontSize(14);
    doc.text(title, 40, 40);
    if (supCode) { doc.setFontSize(11); doc.text(`Supervisor: ${supCode}`, 40, 60); }
    if (outlet) { doc.setFontSize(11); doc.text(`Outlet: ${outlet}`, 40, supCode ? 75 : 60); }

    // Summary
    const baseY = outlet ? (supCode ? 95 : 80) : (supCode ? 80 : 65);
    doc.setFontSize(11);
    doc.text(`Totals — Sales: Ksh ${totals.sales.toLocaleString()}  Expenses: Ksh ${totals.expenses.toLocaleString()}  Waste: Ksh ${totals.waste.toLocaleString()}  Profit: Ksh ${totals.profit.toLocaleString()}  Commission: Ksh ${totals.comm.toLocaleString()}`, 40, baseY);

    // Table
    const head = [["Date", "Outlet", "Sales", "Expenses", "Waste", "Profit", "Rate", "Commission", "Status"]];
    const body = rows.map((r: any) => [
      String(r.date),
      String(r.outletName),
      `Ksh ${num(r.salesKsh).toLocaleString()}`,
      `Ksh ${num(r.expensesKsh).toLocaleString()}`,
      `Ksh ${num(r.wasteKsh).toLocaleString()}`,
      `Ksh ${num(r.profitKsh).toLocaleString()}`,
      `${(Number(r.commissionRate || 0) * 100).toFixed(1)}%`,
      `Ksh ${num(r.commissionKsh).toLocaleString()}`,
      String(r.status || "")
    ]);
    autoTable(doc, {
      head,
      body,
      startY: baseY + 20,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      columnStyles: {
        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }
      },
      didDrawPage: (data) => {
        const page = doc.getCurrentPageInfo().pageNumber;
        const totalPages = doc.getNumberOfPages();
        doc.setFontSize(9);
        doc.text(`${page} / ${totalPages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
      }
    });

    const pdfArray = doc.output("arraybuffer") as ArrayBuffer;
    const buf = Buffer.from(pdfArray as any);
    const fname = `commissions_${start}_to_${end}${supCode ? `_${supCode}` : ""}${outlet ? `_${outlet}` : ""}.pdf`;
    return new Response(buf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=\"${fname}\"` } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outlet = searchParams.get("outlet") || "";
  const date = new Date().toISOString().slice(0, 10);
  if (!outlet)
    return NextResponse.json({
      ok: true,
      totals: {
        weightSales: 0,
        expenses: 0,
        todayTotalSales: 0,
        tillSalesGross: 0,
        verifiedDeposits: 0,
        netTill: 0,
        amountToDeposit: 0,
      },
    });

  const [openRows, closingRows, pbRows, products, expenses, deposits] = await Promise.all([
    prisma.supplyOpeningRow.findMany({ where: { date, outletName: outlet } }),
    prisma.attendantClosing.findMany({ where: { date, outletName: outlet } }),
    prisma.pricebookRow.findMany({ where: { outletName: outlet } }),
    prisma.product.findMany(),
    prisma.attendantExpense.findMany({ where: { date, outletName: outlet } }),
    prisma.attendantDeposit.findMany({ where: { date, outletName: outlet } }),
  ]);

  const pb = new Map(pbRows.map((r) => [`${r.productKey}`, r] as const));
  const prod = new Map(products.map((p) => [p.key, p] as const));
  const closingMap = new Map(closingRows.map((r) => [r.itemKey, r] as const));

  let weightSales = 0;

  for (const row of openRows) {
    const cl = closingMap.get(row.itemKey);
    const closing = cl?.closingQty || 0;
    const waste = cl?.wasteQty || 0;
    const soldQty = Math.max(0, (row.qty || 0) - closing - waste);

    // price: pricebook active else product active
    const pbr = pb.get(row.itemKey);
    const price = pbr ? (pbr.active ? pbr.sellPrice : 0) : prod.get(row.itemKey)?.active ? prod.get(row.itemKey)?.sellPrice || 0 : 0;

    weightSales += soldQty * price;
  }

  const expensesSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const tillSalesGross = 0; // hook up to POS later if needed
  const verifiedDeposits = deposits.filter((d) => d.status !== "INVALID").reduce((a, d) => a + (d.amount || 0), 0);

  const todayTotalSales = weightSales - expensesSum;
  const netTill = tillSalesGross - verifiedDeposits;
  const amountToDeposit = todayTotalSales - netTill;

  return NextResponse.json({
    ok: true,
    totals: {
      weightSales,
      expenses: expensesSum,
      todayTotalSales,
      tillSalesGross,
      verifiedDeposits,
      netTill,
      amountToDeposit,
    },
  });
}

import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/wa";

type BreakdownRow = {
  key: string;
  name: string;
  unit: string;
  opening: number;
  closing: number;
  waste: number;
  soldQty: number;
  price: number;
  revenue: number;
};

function fmtQty(n: number): string {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
function fmtKsh(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString();
}

async function computeBreakdown(date: string, outletName: string): Promise<{
  rows: BreakdownRow[];
  assumedZeroClosingKeys: string[]; // keys with opening>0 but no closing row
  totals: {
    revenue: number;
    expenses: number;
    deposits: number; // verified sum
    outstanding: number; // revenue - expenses - deposits (today only)
    carryoverPrev: number; // previous day's outstanding
    totalToDeposit: number; // carryoverPrev + outstanding
    totalKgSold: number;
    openingTotal: number;
    wasteTotal: number;
    avgSalePerKg: number;
    wasteRatio: number; // wasteTotal/openingTotal
    outstandingRatio: number; // outstanding/revenue
  };
}> {
  // Load inputs
  const [products, pbRows, expenses, deposits] = await Promise.all([
    (prisma as any).product.findMany({ select: { key: true, name: true, unit: true } }),
    (prisma as any).pricebookRow.findMany({ where: { outletName, active: true } }),
    (prisma as any).attendantExpense.findMany({ where: { date, outletName } }),
    (prisma as any).attendantDeposit.findMany({ where: { date, outletName } }),
  ]);
  const prodByKey = new Map<string, { name: string; unit: string }>();
  for (const p of products || []) prodByKey.set(String(p.key), { name: String(p.name || String(p.key)), unit: String(p.unit || "kg") });
  const priceByKey = new Map<string, number>();
  for (const r of pbRows || []) priceByKey.set(String(r.productKey), Number(r.sellPrice || 0));

  // Opening-effective map (yesterday closing + today supply), case-insensitive aggregation, but keep canonical product keys
  const dt = new Date(date + "T00:00:00.000Z"); dt.setUTCDate(dt.getUTCDate() - 1);
  const prevDate = dt.toISOString().slice(0, 10);
  const [prevClosings, todaySupply, todayClosings] = await Promise.all([
    (prisma as any).attendantClosing.findMany({ where: { date: prevDate, outletName } }),
    (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName } }),
    (prisma as any).attendantClosing.findMany({ where: { date, outletName } }),
  ]);
  // Map lowercased key -> canonical key (prefer actual product key if present)
  const canonKey = (k: string) => String(k || "");
  const openEffLc = new Map<string, number>();
  for (const r of prevClosings || []) {
    const kLc = String((r as any).itemKey || "").toLowerCase(); if (!kLc) continue;
    openEffLc.set(kLc, (openEffLc.get(kLc) || 0) + Number((r as any).closingQty || 0));
  }
  for (const r of todaySupply || []) {
    const kLc = String((r as any).itemKey || "").toLowerCase(); if (!kLc) continue;
    openEffLc.set(kLc, (openEffLc.get(kLc) || 0) + Number((r as any).qty || 0));
  }
  const closingByLc = new Map<string, { closing: number; waste: number; key: string }>();
  for (const r of todayClosings || []) {
    const kLc = String((r as any).itemKey || "").toLowerCase(); if (!kLc) continue;
    closingByLc.set(kLc, { closing: Number((r as any).closingQty || 0), waste: Number((r as any).wasteQty || 0), key: canonKey((r as any).itemKey) });
  }

  // Determine a union of keys to report: all that have opening>0 or a closing row
  const keyLcs = new Set<string>([...openEffLc.keys(), ...closingByLc.keys()]);
  const rows: BreakdownRow[] = [];
  let revenue = 0, totalKgSold = 0, openingTotal = 0, wasteTotal = 0;
  const assumedZeroClosingKeys: string[] = [];
  for (const kLc of keyLcs) {
    const open = Number(openEffLc.get(kLc) || 0);
    const closingObj = closingByLc.get(kLc);
    const closing = Number(closingObj?.closing || 0);
    const waste = Number(closingObj?.waste || 0);
    const key = closingObj?.key || Array.from(prodByKey.keys()).find((k) => String(k).toLowerCase() === kLc) || kLc.toUpperCase();
    const prod = prodByKey.get(key) || { name: key, unit: "kg" };
    const sold = Math.max(0, open - closing - waste);
    const price = Number(priceByKey.get(key) || 0);
    const rev = sold * (price > 0 ? price : 0);
    if (open > 0 && !closingByLc.has(kLc)) assumedZeroClosingKeys.push(key);
    rows.push({ key, name: prod.name, unit: prod.unit, opening: open, closing, waste, soldQty: sold, price, revenue: rev });
    revenue += rev; totalKgSold += sold; openingTotal += open; wasteTotal += waste;
  }
  const expensesSum = (expenses || []).reduce((a: number, e: any) => a + Number(e.amount || 0), 0);
  const depositsVerified = (deposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + Number(d.amount || 0), 0);
  const outstanding = revenue - expensesSum - depositsVerified;

  // Compute carryover from previous day: (yRevenue - yExpenses - yVerifiedDeposits)
  const yDt = new Date(date + "T00:00:00.000Z"); yDt.setUTCDate(yDt.getUTCDate() - 1);
  const yDate = yDt.toISOString().slice(0,10);
  const [yOpenRows, yClosingRows, yExpenses, yDeposits] = await Promise.all([
    (prisma as any).supplyOpeningRow.findMany({ where: { date: yDate, outletName } }),
    (prisma as any).attendantClosing.findMany({ where: { date: yDate, outletName } }),
    (prisma as any).attendantExpense.findMany({ where: { date: yDate, outletName } }),
    (prisma as any).attendantDeposit.findMany({ where: { date: yDate, outletName } }),
  ]);
  const yClosingMap = new Map<string, any>((yClosingRows || []).map((r: any) => [String(r.itemKey), r] as const));
  let yRevenue = 0;
  for (const row of (yOpenRows || [])) {
    const cl = yClosingMap.get(String((row as any).itemKey));
    const closing = Number((cl as any)?.closingQty || 0);
    const waste = Number((cl as any)?.wasteQty || 0);
    const sold = Math.max(0, Number((row as any).qty || 0) - closing - waste);
    const price = Number(priceByKey.get(String((row as any).itemKey)) || 0);
    yRevenue += sold * (price > 0 ? price : 0);
  }
  const yExpensesSum = (yExpenses || []).reduce((a: number, e: any) => a + Number(e.amount || 0), 0);
  const yDepositsVerified = (yDeposits || []).filter((d: any) => d.status !== "INVALID").reduce((a: number, d: any) => a + Number(d.amount || 0), 0);
  const carryoverPrev = Math.max(0, yRevenue - yExpensesSum - yDepositsVerified);
  const totalToDeposit = Math.max(0, carryoverPrev + outstanding);
  const avgSalePerKg = totalKgSold > 0 ? revenue / totalKgSold : 0;
  const wasteRatio = openingTotal > 0 ? wasteTotal / openingTotal : 0;
  const outstandingRatio = revenue > 0 ? outstanding / revenue : 0;

  return {
    rows,
    assumedZeroClosingKeys,
    totals: { revenue, expenses: expensesSum, deposits: depositsVerified, outstanding, carryoverPrev, totalToDeposit, totalKgSold, openingTotal, wasteTotal, avgSalePerKg, wasteRatio, outstandingRatio },
  };
}

function buildSupervisorMessage(opts: { recipientName: string; outlet: string; date: string; attendantName: string; data: Awaited<ReturnType<typeof computeBreakdown>> }) {
  const { recipientName, outlet, date, attendantName, data } = opts;
  const perLines = data.rows
    .filter(r => r.soldQty > 0)
    .sort((a,b)=> b.revenue - a.revenue)
    .slice(0, 10)
    .map(r => `   - ${r.name} sold: ${fmtQty(r.soldQty)}${r.unit ? ` ${r.unit}`: ''}, Ksh ${fmtKsh(r.revenue)}`);
  const more = data.rows.filter(r => r.soldQty > 0).length > 10 ? `\n   (+${data.rows.filter(r => r.soldQty > 0).length - 10} more)` : '';
  const wasteParts = data.rows.filter(r=> r.waste>0).map(r=> `${r.name} ${fmtQty(r.waste)}${r.unit?` ${r.unit}`:''}`);
  const assumed = data.assumedZeroClosingKeys.map(k => {
    const n = data.rows.find(r => r.key === k)?.name || k; return n; });
  const body = [
    `Hello ${recipientName},`,
    ``,
    `Daily summary for outlet ${outlet}, submitted by ${attendantName}, on ${date}:`,
    ``,
    `• Weight sales per product:`,
    ...(perLines.length ? perLines : ["   - (no sales recorded)"]),
    more,
    `• Total weight sales (revenue): Ksh ${fmtKsh(data.totals.revenue)}`,
    `• Expenses recorded: Ksh ${fmtKsh(data.totals.expenses)}`,
    `• Approx. profit (revenue – expenses): Ksh ${fmtKsh(data.totals.revenue - data.totals.expenses)}`,
  `• Deposits made: Ksh ${fmtKsh(data.totals.deposits)}`,
  `• Carryover (previous): Ksh ${fmtKsh(data.totals.carryoverPrev)}`,
  `• Today cash to deposit: Ksh ${fmtKsh(Math.max(0, data.totals.outstanding))}`,
  `• Total amount to deposit: Ksh ${fmtKsh(data.totals.totalToDeposit)}`,
    wasteParts.length ? `• Waste recorded: ${wasteParts.join(", ")}` : `• Waste recorded: 0`,
    assumed.length ? `• Closing stock assumptions: ${assumed.join(", ")} defaulted to 0 kg (no closing entry).` : ``,
    ``,
    `Key performance metrics:`,
    `• Average sale per kg: Ksh ${fmtKsh(data.totals.avgSalePerKg)}/kg`,
    `• Waste ratio: ${(data.totals.wasteRatio*100).toFixed(1)}%`,
    `• Outstanding deposit ratio: ${(data.totals.outstandingRatio*100).toFixed(1)}%`,
    ``,
    `Please review and follow up if figures seem off. Adjustments in the dashboard will notify all parties.`,
  ].filter(Boolean);
  return body.join("\n");
}

function buildAdminMessage(opts: { recipientName: string; outlet: string; date: string; attendantName: string; data: Awaited<ReturnType<typeof computeBreakdown>> }) {
  const { recipientName, outlet, date, attendantName, data } = opts;
  const closingParts = data.rows.map(r => `${r.name} ${fmtQty(r.closing)}${r.unit?` ${r.unit}`:''}`);
  const wasteParts = data.rows.filter(r=> r.waste>0).map(r=> `${r.name} ${fmtQty(r.waste)}${r.unit?` ${r.unit}`:''}`);
  const body = [
    `Hello ${recipientName},`,
    ``,
    `Summary for outlet ${outlet}, submitted by ${attendantName}, on ${date}:`,
    ``,
    `• Weight sales (revenue): Ksh ${fmtKsh(data.totals.revenue)}`,
    `• Expenses recorded: Ksh ${fmtKsh(data.totals.expenses)}`,
    `• Approx. profit (revenue – expenses): Ksh ${fmtKsh(data.totals.revenue - data.totals.expenses)}`,
  `• Deposits made: Ksh ${fmtKsh(data.totals.deposits)}`,
  `• Carryover (previous): Ksh ${fmtKsh(data.totals.carryoverPrev)}`,
  `• Today cash to deposit: Ksh ${fmtKsh(Math.max(0, data.totals.outstanding))}`,
  `• Total amount to deposit: Ksh ${fmtKsh(data.totals.totalToDeposit)}`,
    `• Closing stock details: ${closingParts.join(", ")}`,
    wasteParts.length ? `• Waste recorded: ${wasteParts.join(", ")}` : `• Waste recorded: 0`,
    ``,
    `Performance highlights:`,
    `• Average sale per kg: Ksh ${fmtKsh(data.totals.avgSalePerKg)}/kg`,
    `• Waste ratio: ${(data.totals.wasteRatio*100).toFixed(1)}%`,
    `• Outstanding deposit ratio: ${(data.totals.outstandingRatio*100).toFixed(1)}%`,
    ``,
    `The trading period is now closed and a new period has started. Adjustments will notify all parties.`,
  ];
  return body.join("\n");
}

function buildSupplierMessage(opts: { recipientName: string; outlet: string; date: string; attendantName: string; data: Awaited<ReturnType<typeof computeBreakdown>> }) {
  const { recipientName, outlet, date, attendantName, data } = opts;
  const lines = data.rows.map(r => `• ${r.name}: ${fmtQty(r.closing)}${r.unit?` ${r.unit}`:''}${r.closing === 0 ? " (needs replenishment)" : ""}`);
  const body = [
    `Hello ${recipientName},`,
    ``,
    `Closing stock for outlet ${outlet} (submitted by ${attendantName}) on ${date}:`,
    ``,
    ...lines,
    ``,
    `Please plan tomorrow’s supply based on these closing quantities.`,
  ];
  return body.join("\n");
}

function buildAttendantMessage(opts: { recipientName: string; date: string; data: Awaited<ReturnType<typeof computeBreakdown>> }) {
  const { recipientName, date, data } = opts;
  const body = [
    `Hello ${recipientName},`,
    ``,
    `Your trading period for ${date} is now closed.`,
    ``,
    `• Weight sales: Ksh ${fmtKsh(data.totals.revenue)}`,
    `• Expenses: Ksh ${fmtKsh(data.totals.expenses)}`,
    `• Total sales (Weight – Expenses): Ksh ${fmtKsh(data.totals.revenue - data.totals.expenses)}`,
  `• Deposits recorded: Ksh ${fmtKsh(data.totals.deposits)}`,
  `• Carryover (previous): Ksh ${fmtKsh(data.totals.carryoverPrev)}`,
  `• Today cash to deposit: Ksh ${fmtKsh(Math.max(0, data.totals.outstanding))}`,
  `• Total amount to deposit: Ksh ${fmtKsh(data.totals.totalToDeposit)}`,
    ``,
    `Please ensure the remaining cash deposit is made. Once deposits are verified, this amount will reduce accordingly.`,
    `Thank you for your work today.`,
  ];
  return body.join("\n");
}

export async function sendDayCloseNotifications(args: { date: string; outletName: string; attendantCode?: string | null }) {
  const { date, outletName, attendantCode } = args;
  // Compute data once
  const data = await computeBreakdown(date, outletName);

  // Resolve recipients
  const [attMappings, supMappings, admMappings, atts, supplierMappings] = await Promise.all([
    (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet: outletName }, select: { code: true, phoneE164: true } }).catch(() => []),
    (prisma as any).phoneMapping.findMany({ where: { role: "supervisor", outlet: outletName }, select: { code: true, phoneE164: true } }).catch(() => []),
    (prisma as any).phoneMapping.findMany({ where: { role: "admin" }, select: { code: true, phoneE164: true } }).catch(() => []),
    (prisma as any).attendant.findMany({ select: { loginCode: true, name: true } }).catch(() => []),
    (prisma as any).phoneMapping.findMany({ where: { role: "supplier", outlet: outletName }, select: { code: true, phoneE164: true } }).catch(() => []),
  ]);
  const attendantName = (() => {
    if (!attendantCode) return "Attendant";
    const a = (atts || []).find((r: any) => String(r.loginCode || "").toLowerCase() === String(attendantCode || "").toLowerCase());
    return a?.name || attendantCode || "Attendant";
  })();

  const supPhones = (supMappings || []).map((r: any) => r.phoneE164).filter(Boolean) as string[];
  let adminPhones = (admMappings || []).map((r: any) => r.phoneE164).filter(Boolean) as string[];
  // Default admin phone fallback
  if (!adminPhones.length) adminPhones = ["+254705663175"]; // permanent default per request

  // Supplier recipients (by outlet)
  const supplierPhones = (supplierMappings || []).map((r: any) => r.phoneE164).filter(Boolean) as string[];

  // Resolve person names by code for supervisors/admins/suppliers/attendant
  const codes = Array.from(new Set([
    ...(supMappings || []).map((r: any) => r.code).filter(Boolean),
    ...(admMappings || []).map((r: any) => r.code).filter(Boolean),
    ...(supplierMappings || []).map((r: any) => r.code).filter(Boolean),
    ...(attMappings || []).map((r: any) => r.code).filter(Boolean),
    args.attendantCode || undefined,
  ].filter(Boolean) as string[]));
  let nameByCode = new Map<string, string>();
  if (codes.length) {
    try {
      const pcs = await (prisma as any).personCode.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } });
      for (const pc of pcs || []) nameByCode.set(String(pc.code), String(pc.name || ""));
    } catch {}
  }

  // Build messages
  // Build sender for each recipient with personalized greeting
  type OutMsg = { to: string; text: string };
  const supMsgs: OutMsg[] = (supMappings || [])
    .map((m: any): OutMsg | null => {
      const to = String(m.phoneE164 || "");
      if (!to) return null;
      const text = buildSupervisorMessage({ recipientName: nameByCode.get(m.code) || "Supervisor", outlet: outletName, date, attendantName, data });
      return { to, text };
    })
    .filter((x: OutMsg | null): x is OutMsg => !!x);
  const admMsgs: OutMsg[] = (admMappings || [])
    .map((m: any): OutMsg | null => {
      const to = String(m.phoneE164 || "");
      if (!to) return null;
      const text = buildAdminMessage({ recipientName: nameByCode.get(m.code) || "Admin", outlet: outletName, date, attendantName, data });
      return { to, text };
    })
    .filter((x: OutMsg | null): x is OutMsg => !!x);
  const supTextWithHello = undefined; const admTextWithHello = undefined; // no longer used; kept for clarity
  const supplierMsgs: OutMsg[] = (supplierMappings || [])
    .map((m: any): OutMsg | null => {
      const to = String(m.phoneE164 || "");
      if (!to) return null;
      const text = buildSupplierMessage({ recipientName: nameByCode.get(m.code) || "Supplier", outlet: outletName, date, attendantName, data });
      return { to, text };
    })
    .filter((x: OutMsg | null): x is OutMsg => !!x);
  const attendantRecipient = (args.attendantCode && (attMappings || []).find((m: any) => String(m.code || '').toLowerCase() === String(args.attendantCode || '').toLowerCase())) || null;
  const attendantMsg: OutMsg[] = attendantRecipient
    ? [{ to: String(attendantRecipient.phoneE164 || ""), text: buildAttendantMessage({ recipientName: nameByCode.get(attendantRecipient.code) || "Attendant", date, data }) }].filter((x: OutMsg) => !!x.to)
    : (attMappings || [])
        .map((m: any): OutMsg | null => {
          const to = String(m.phoneE164 || "");
          if (!to) return null;
          const text = buildAttendantMessage({ recipientName: nameByCode.get(m.code) || "Attendant", date, data });
          return { to, text };
        })
        .filter((x: OutMsg | null): x is OutMsg => !!x);

  // Send (best-effort)
  await Promise.allSettled([
    ...supMsgs.map((msg: OutMsg) => sendText(msg.to, msg.text, "AI_DISPATCH_TEXT", { gpt_sent: true })),
    ...adminPhones.map((to) => {
      const code = (admMappings || []).find((m: any) => m.phoneE164 === to)?.code;
      const name = code ? (nameByCode.get(code) || "Admin") : "Admin";
      const text = buildAdminMessage({ recipientName: name, outlet: outletName, date, attendantName, data });
      return sendText(to, text, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }),
    ...supplierMsgs.map((msg: OutMsg) => sendText(msg.to, msg.text, "AI_DISPATCH_TEXT", { gpt_sent: true })),
    ...attendantMsg.map((msg: OutMsg) => sendText(msg.to, msg.text, "AI_DISPATCH_TEXT", { gpt_sent: true })),
  ]);
}

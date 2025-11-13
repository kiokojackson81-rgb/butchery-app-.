import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";
import { getAssignmentSnapshot } from "@/server/assignments";
import { isGeneralDepositAttendant } from "@/server/general_deposit";
import { APP_TZ, addDaysISO, dateISOInTZ, getPeriodState, PeriodState } from "@/server/trading_period";

type AssistantCheck = {
  ok: boolean;
  reason?: "invalid-code" | "not-assistant";
  code: string;
};

export async function isAssistant(codeRaw?: string | null): Promise<boolean> {
  const code = canonFull(codeRaw || "");
  if (!code) return false;
  // Primary source of truth: PersonCode role
  try {
    const person = await prisma.personCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" }, active: true },
      select: { role: true },
    });
    if (person && String(person.role).toLowerCase() === "assistant") return true;
  } catch {}
  // Fallback to existing general deposit allow-list
  try {
    return await isGeneralDepositAttendant(codeRaw || "");
  } catch {
    return false;
  }
}

function normalizeDate(raw?: string | null): string {
  if (!raw) return dateISOInTZ(new Date(), APP_TZ);
  const trimmed = String(raw).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return dateISOInTZ(new Date(trimmed), APP_TZ);
}

type BreakdownRow = {
  productKey: string;
  productName: string;
  openingQty: number;
  supplyQty: number;
  closingQty: number;
  wasteQty: number;
  salesUnits: number;
  price: number;
  salesValue: number;
  excludedReason?: string;
};

export type AssistantDepositComputation = {
  ok: boolean;
  reason?: "invalid-code" | "not-assistant" | "missing-outlet" | "no-products" | "period-locked";
  code: string;
  date: string;
  outletName: string | null;
  periodState: PeriodState;
  salesValue: number;
  expensesValue: number;
  carryoverPrev: number;
  expected: number;
  depositedSoFar: number;
  recommendedNow: number;
  breakdownByProduct: BreakdownRow[];
  warnings: string[];
};

type ComputeArgs = {
  code: string;
  date?: string;
  outletName?: string | null;
  respectAllowlist?: boolean;
};

type ClosingInfo = { closing: number; waste: number };

function buildClosingInfo(rows: Array<any>): Map<string, ClosingInfo> {
  const map = new Map<string, ClosingInfo>();
  for (const row of rows || []) {
    const key = String(row?.itemKey || "").toLowerCase();
    if (!key) continue;
    const closing = Number(row?.closingQty || 0);
    const waste = Number(row?.wasteQty || 0);
    if (!Number.isFinite(closing) && !Number.isFinite(waste)) continue;
    if (!map.has(key)) map.set(key, { closing: 0, waste: 0 });
    const info = map.get(key)!;
    if (Number.isFinite(closing)) info.closing += closing;
    if (Number.isFinite(waste)) info.waste += waste;
  }
  return map;
}

function buildSupplyMap(rows: Array<any>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows || []) {
    const key = String(row?.itemKey || "").toLowerCase();
    if (!key) continue;
    const qty = Number(row?.qty || 0);
    if (!Number.isFinite(qty)) continue;
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

function sumDeposits(rows: Array<any>): number {
  return (rows || []).reduce((sum, row) => {
    const amt = Number(row?.amount || 0);
    const status = String(row?.status || "").toUpperCase();
    if (!Number.isFinite(amt) || status === "INVALID") return sum;
    return sum + Math.max(0, amt);
  }, 0);
}

function computeSalesValue(
  productKeys: string[],
  openingInfo: Map<string, ClosingInfo>,
  supplyMap: Map<string, number>,
  closingInfo: Map<string, ClosingInfo>,
  priceByKey: Map<string, number>
): number {
  let total = 0;
  for (const originalKey of productKeys) {
    const keyLc = originalKey.toLowerCase();
    const price = Number(priceByKey.get(keyLc) || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const openingQty = openingInfo.get(keyLc)?.closing || 0;
    const supplyQty = supplyMap.get(keyLc) || 0;
    const closingQty = closingInfo.get(keyLc)?.closing || 0;
    const wasteQty = closingInfo.get(keyLc)?.waste || 0;
    const salesUnits = Math.max(0, openingQty + supplyQty - closingQty - wasteQty);
    total += salesUnits * price;
  }
  return total;
}

function buildOpeningFromClosings(source: Map<string, ClosingInfo>): Map<string, ClosingInfo> {
  const map = new Map<string, ClosingInfo>();
  for (const [key, info] of source.entries()) {
    const closing = Number(info?.closing || 0);
    const waste = Number(info?.waste || 0);
    const openingQty = Math.max(0, closing + waste);
    map.set(key, { closing: openingQty, waste: 0 });
  }
  return map;
}

async function ensureAssistant(codeRaw: string, respectAllowlist: boolean | undefined): Promise<AssistantCheck> {
  const code = canonFull(codeRaw || "");
  if (!code) return { ok: false, reason: "invalid-code", code };
  if (respectAllowlist === false) return { ok: true, code };
  const allowed = await isAssistant(code);
  if (!allowed) return { ok: false, reason: "not-assistant", code };
  return { ok: true, code };
}

export async function computeAssistantExpectedDeposit(args: ComputeArgs): Promise<AssistantDepositComputation> {
  const { code: rawCode, respectAllowlist } = args;
  const check = await ensureAssistant(rawCode, respectAllowlist);
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      code: check.code,
      date: normalizeDate(args.date),
      outletName: null,
      periodState: "OPEN",
      salesValue: 0,
      expensesValue: 0,
      carryoverPrev: 0,
      expected: 0,
      depositedSoFar: 0,
      recommendedNow: 0,
      breakdownByProduct: [],
      warnings: [],
    };
  }

  const date = normalizeDate(args.date);
  const prevDate = addDaysISO(date, -1, APP_TZ);
  const prevPrevDate = addDaysISO(prevDate, -1, APP_TZ);

  // Resolve outlet + products from assignment snapshot unless explicitly provided
  const snapshot = await getAssignmentSnapshot(check.code);
  const outletName = args.outletName || snapshot.outlet || null;
  const productKeys = Array.from(new Set(snapshot.productKeys || [])).filter((k) => k.length > 0);

  if (!outletName) {
    return {
      ok: false,
      reason: "missing-outlet",
      code: check.code,
      date,
      outletName: null,
      periodState: "OPEN",
      salesValue: 0,
      expensesValue: 0,
      carryoverPrev: 0,
      expected: 0,
      depositedSoFar: 0,
      recommendedNow: 0,
      breakdownByProduct: [],
      warnings: ["Outlet not assigned to assistant."],
    };
  }

  const periodState = await getPeriodState(outletName, date).catch(() => "OPEN" as PeriodState);

  if (productKeys.length === 0) {
    return {
      ok: periodState === "OPEN",
      reason: "no-products",
      code: check.code,
      date,
      outletName,
      periodState,
      salesValue: 0,
      expensesValue: 0,
      carryoverPrev: 0,
      expected: 0,
      depositedSoFar: 0,
      recommendedNow: 0,
      breakdownByProduct: [],
      warnings: ["No products scoped to assistant."],
    };
  }

  const keysLc = new Set(productKeys.map((k) => k.toLowerCase()));

  const [
    prevClosings,
    todayClosings,
    prevPrevClosings,
    supplyRows,
    prevSupplyRows,
    pricebookRows,
    productRows,
    expenseRows,
    prevExpenseRows,
    depositRows,
    prevDepositRows,
  ] = await Promise.all([
    prisma.attendantClosing
      .findMany({ where: { date: prevDate, outletName }, select: { itemKey: true, closingQty: true, wasteQty: true } })
      .catch(() => []),
    prisma.attendantClosing
      .findMany({ where: { date, outletName }, select: { itemKey: true, closingQty: true, wasteQty: true } })
      .catch(() => []),
    prisma.attendantClosing
      .findMany({ where: { date: prevPrevDate, outletName }, select: { itemKey: true, closingQty: true, wasteQty: true } })
      .catch(() => []),
    prisma.supplyOpeningRow
      .findMany({ where: { date, outletName }, select: { itemKey: true, qty: true } })
      .catch(() => []),
    prisma.supplyOpeningRow
      .findMany({ where: { date: prevDate, outletName }, select: { itemKey: true, qty: true } })
      .catch(() => []),
    prisma.pricebookRow
      .findMany({ where: { outletName }, select: { productKey: true, sellPrice: true, active: true } })
      .catch(() => []),
    prisma.product
      .findMany({ where: { key: { in: productKeys } }, select: { key: true, name: true, sellPrice: true, active: true } })
      .catch(() => []),
    prisma.attendantExpense
      .findMany({ where: { date, outletName }, select: { amount: true } })
      .catch(() => []),
    prisma.attendantExpense
      .findMany({ where: { date: prevDate, outletName }, select: { amount: true } })
      .catch(() => []),
    prisma.$queryRaw<
      Array<{ amount: number | null; status: string | null }>
    >`SELECT "amount", "status" FROM "AttendantDeposit" WHERE "date"=${date} AND "outletName"=${outletName}`
      .catch(() => []),
    prisma.$queryRaw<
      Array<{ amount: number | null; status: string | null }>
    >`SELECT "amount", "status" FROM "AttendantDeposit" WHERE "date"=${prevDate} AND "outletName"=${outletName}`
      .catch(() => []),
  ]);

  const filterClosingRows = (rows: any[]) =>
    (rows || []).filter((row) => keysLc.has(String(row?.itemKey || "").toLowerCase()));
  const filterSupplyRows = (rows: any[]) =>
    (rows || []).filter((row) => keysLc.has(String(row?.itemKey || "").toLowerCase()));

  const prevClosingInfo = buildClosingInfo(filterClosingRows(prevClosings as any[]));
  const todayClosingInfo = buildClosingInfo(filterClosingRows(todayClosings as any[]));
  const prevPrevClosingInfo = buildClosingInfo(filterClosingRows(prevPrevClosings as any[]));

  const openingInfoToday = buildOpeningFromClosings(prevClosingInfo);
  const openingInfoPrev = buildOpeningFromClosings(prevPrevClosingInfo);

  const supplyMapToday = buildSupplyMap(filterSupplyRows(supplyRows as any[]));
  const supplyMapPrev = buildSupplyMap(filterSupplyRows(prevSupplyRows as any[]));

  const priceByKey = new Map<string, number>();
  for (const row of pricebookRows as any[]) {
    const key = String(row?.productKey || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const price = Number(row?.sellPrice || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (row?.active) priceByKey.set(key, price);
  }
  for (const row of productRows as any[]) {
    const key = String(row?.key || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    if (!priceByKey.has(key)) {
      const price = Number(row?.sellPrice || 0);
      if (Number.isFinite(price) && price > 0 && row?.active) {
        priceByKey.set(key, price);
      }
    }
  }

  const nameByKey = new Map<string, string>();
  for (const row of productRows as any[]) {
    const key = String(row?.key || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const label = String(row?.name || "").trim();
    if (label) nameByKey.set(key, label);
  }

  const salesValue = computeSalesValue(productKeys, openingInfoToday, supplyMapToday, todayClosingInfo, priceByKey);
  const prevSalesValue = computeSalesValue(productKeys, openingInfoPrev, supplyMapPrev, prevClosingInfo, priceByKey);

  const expensesValue = (expenseRows as any[]).reduce((sum, row) => {
    const amt = Number(row?.amount || 0);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);
  const prevExpensesValue = (prevExpenseRows as any[]).reduce((sum, row) => {
    const amt = Number(row?.amount || 0);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);

  const depositedSoFar = sumDeposits(depositRows as any[]);
  const prevDeposited = sumDeposits(prevDepositRows as any[]);

  const carryoverPrev = Math.max(0, prevSalesValue - prevExpensesValue - prevDeposited);
  const expected = salesValue - expensesValue;
  const recommendedNow = Math.max(carryoverPrev + expected - depositedSoFar, 0);

  const breakdown: BreakdownRow[] = [];
  const warnings: string[] = [];
  for (const originalKey of productKeys) {
    const keyLc = originalKey.toLowerCase();
    const prevClose = prevClosingInfo.get(keyLc);
    const openingQty = Math.max(0, (prevClose?.closing || 0) + (prevClose?.waste || 0));
    const supplyQty = Number(supplyMapToday.get(keyLc) || 0);
    const closeInfo = todayClosingInfo.get(keyLc);
    const closingQty = Number(closeInfo?.closing || 0);
    const wasteQty = Number(closeInfo?.waste || 0);
    const salesUnits = Math.max(0, openingQty + supplyQty - closingQty - wasteQty);
    const price = Number(priceByKey.get(keyLc) || 0);
    const productName = nameByKey.get(keyLc) || originalKey;
    let excludedReason: string | undefined;
    let salesValueRow = 0;

    if (!Number.isFinite(price) || price <= 0) {
      excludedReason = "missing-price";
      warnings.push(`No active price for ${productName}; excluded from sales.`);
    } else {
      salesValueRow = salesUnits * price;
    }

    breakdown.push({
      productKey: originalKey,
      productName,
      openingQty,
      supplyQty,
      closingQty,
      wasteQty,
      salesUnits,
      price,
      salesValue: salesValueRow,
      excludedReason,
    });
  }

  return {
    ok: periodState === "OPEN",
    reason: periodState === "OPEN" ? undefined : "period-locked",
    code: check.code,
    date,
    outletName,
    periodState,
    salesValue,
    expensesValue,
    carryoverPrev,
    expected,
    depositedSoFar,
    recommendedNow,
    breakdownByProduct: breakdown,
    warnings,
  };
}

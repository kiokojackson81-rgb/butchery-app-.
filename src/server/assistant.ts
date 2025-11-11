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
      expected: 0,
      depositedSoFar: 0,
      recommendedNow: 0,
      breakdownByProduct: [],
      warnings: [],
    };
  }

  const date = normalizeDate(args.date);
  const prevDate = addDaysISO(date, -1, APP_TZ);

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
    supplyRows,
    pricebookRows,
    productRows,
    expenseRows,
    depositRows,
  ] = await Promise.all([
    prisma.attendantClosing
      .findMany({ where: { date: prevDate, outletName }, select: { itemKey: true, closingQty: true } })
      .catch(() => []),
    prisma.attendantClosing
      .findMany({ where: { date, outletName }, select: { itemKey: true, closingQty: true } })
      .catch(() => []),
    prisma.supplyOpeningRow
      .findMany({ where: { date, outletName }, select: { itemKey: true, qty: true } })
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
    prisma.$queryRaw<
      Array<{ amount: number | null; status: string | null }>
    >`SELECT "amount", "status" FROM "AttendantDeposit" WHERE "date"=${date} AND "outletName"=${outletName}`
      .catch(() => []),
  ]);

  const prevClosingMap = new Map<string, number>();
  for (const row of prevClosings as any[]) {
    const key = String(row?.itemKey || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const qty = Number(row?.closingQty || 0);
    if (!Number.isFinite(qty)) continue;
    prevClosingMap.set(key, (prevClosingMap.get(key) || 0) + qty);
  }

  const supplyMap = new Map<string, number>();
  for (const row of supplyRows as any[]) {
    const key = String(row?.itemKey || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const qty = Number(row?.qty || 0);
    if (!Number.isFinite(qty)) continue;
    supplyMap.set(key, (supplyMap.get(key) || 0) + qty);
  }

  const closingMap = new Map<string, number>();
  for (const row of todayClosings as any[]) {
    const key = String(row?.itemKey || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const qty = Number(row?.closingQty || 0);
    if (!Number.isFinite(qty)) continue;
    closingMap.set(key, qty);
  }

  const priceByKey = new Map<string, number>();
  for (const row of pricebookRows as any[]) {
    const key = String(row?.productKey || "").toLowerCase();
    if (!keysLc.has(key)) continue;
    const price = Number(row?.sellPrice || 0);
    if (!Number.isFinite(price)) continue;
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

  const breakdown: BreakdownRow[] = [];
  const warnings: string[] = [];
  let salesValue = 0;

  for (const originalKey of productKeys) {
    const keyLc = originalKey.toLowerCase();
    const openingQty = Number(prevClosingMap.get(keyLc) || 0);
    const supplyQty = Number(supplyMap.get(keyLc) || 0);
    const closingQty = Number(closingMap.get(keyLc) || 0);
    const salesUnits = Math.max(0, openingQty + supplyQty - closingQty);
    const price = Number(priceByKey.get(keyLc) || 0);
    const productName = nameByKey.get(keyLc) || originalKey;
    let excludedReason: string | undefined;
    let salesValueRow = 0;

    if (!Number.isFinite(price) || price <= 0) {
      excludedReason = "missing-price";
      warnings.push(`No active price for ${productName}; excluded from sales.`);
    } else {
      salesValueRow = salesUnits * price;
      salesValue += salesValueRow;
    }

    breakdown.push({
      productKey: originalKey,
      productName,
      openingQty,
      supplyQty,
      closingQty,
      salesUnits,
      price,
      salesValue: salesValueRow,
      excludedReason,
    });
  }

  const expensesValue = (expenseRows as any[]).reduce((sum, row) => {
    const amt = Number(row?.amount || 0);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);

  const depositedSoFar = (depositRows as any[]).reduce((sum, row) => {
    const amt = Number(row?.amount || 0);
    const status = String(row?.status || "").toUpperCase();
    if (!Number.isFinite(amt) || status === "INVALID") return sum;
    return sum + Math.max(0, amt);
  }, 0);

  const expected = salesValue - expensesValue;
  const recommendedNow = Math.max(expected - depositedSoFar, 0);

  return {
    ok: periodState === "OPEN",
    reason: periodState === "OPEN" ? undefined : "period-locked",
    code: check.code,
    date,
    outletName,
    periodState,
    salesValue,
    expensesValue,
    expected,
    depositedSoFar,
    recommendedNow,
    breakdownByProduct: breakdown,
    warnings,
  };
}


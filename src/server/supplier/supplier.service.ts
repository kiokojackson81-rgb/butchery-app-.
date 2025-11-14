// src/server/supplier/supplier.service.ts
import { prisma } from "@/lib/prisma";
import { ZOpeningRowInput, ZLockDayInput, ZTransferInput, ZDisputeInput, ZRequestEditInput } from "./supplier.validation";

export async function listProductsForOutlet(outlet: string) {
  // active products + pricebook sell price if available
  const products = await (prisma as any).product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const pricebook = await (prisma as any).pricebookRow.findMany({ where: { outletName: outlet, active: true } });
  const map = new Map(pricebook.map((p: any) => [`${p.outletName}:${p.productKey}`, p.sellPrice]));
  return (products || []).map((p: any) => ({
    key: p.key,
    name: p.name,
    unit: p.unit,
    sellPrice: map.get(`${outlet}:${p.key}`) ?? p.sellPrice,
  }));
}

export async function getDaySnapshot(date: string, outlet: string) {
  const rows = await (prisma as any).supplyOpeningRow.findMany({
    where: { date, outletName: outlet },
    orderBy: { itemKey: "asc" },
  });
  const transfers = await (prisma as any).supplyTransfer.findMany({
    where: { date, OR: [{ fromOutletName: outlet }, { toOutletName: outlet }] },
    orderBy: { createdAt: "asc" },
  });

  // Soft lock stored in Setting: key = lock:supply:YYYY-MM-DD:Outlet
  const lockKey = `lock:supply:${date}:${outlet}`;
  const lock = await (prisma as any).setting.findUnique({ where: { key: lockKey } }).catch(() => null);
  const isLocked = Boolean(lock?.value?.locked);

  const disputes = await (prisma as any).reviewItem.count({
    where: { type: "dispute", outlet, date: new Date(date + "T00:00:00.000Z"), status: { in: ["pending", "approved"] } },
  });

  return { rows, transfers, isLocked, disputes };
}

export async function upsertOpeningRow(input: unknown) {
  const { date, outlet, itemKey, qty, buyPrice, unit } = ZOpeningRowInput.parse(input);

  // Validate product & unit
  const prod = await (prisma as any).product.findUnique({ where: { key: itemKey } });
  if (!prod || prod.unit !== unit) throw new Error("Invalid product or unit");

  // Check locked
  const lockKey = `lock:supply:${date}:${outlet}`;
  const lock = await (prisma as any).setting.findUnique({ where: { key: lockKey } });
  if (lock?.value?.locked) {
    const e: any = new Error("Day is locked");
    e.code = 403;
    throw e;
  }

  // Runtime lock column detection (legacy DB compatibility)
  let HAS_LOCK_COLS: boolean = true;
  try {
    await (prisma as any).supplyOpeningRow.findMany({ select: { id: true, lockedAt: true }, take: 1 });
    HAS_LOCK_COLS = true;
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('lockedat') && msg.includes('does not exist')) HAS_LOCK_COLS = false; else HAS_LOCK_COLS = true;
  }

  const existing = await (prisma as any).supplyOpeningRow.findUnique({
    where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } as any },
  });
  if (HAS_LOCK_COLS && existing?.lockedAt) {
    const e: any = new Error("Item already locked");
    e.code = 409;
    throw e;
  }

  // If columns are present we persist lock metadata; legacy mode just updates qty/buyPrice
  if (HAS_LOCK_COLS) {
    const lockStamp = existing?.lockedAt ?? new Date();
    return (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } as any },
      update: {
        qty,
        buyPrice: buyPrice ?? 0,
        unit,
        lockedAt: existing?.lockedAt ?? lockStamp,
        lockedBy: existing?.lockedBy ?? "supplier_portal",
      },
      create: {
        date,
        outletName: outlet,
        itemKey,
        qty,
        buyPrice: buyPrice ?? 0,
        unit,
        lockedAt: lockStamp,
        lockedBy: "supplier_portal",
      },
    });
  } else {
    // Legacy path (no lockedAt/lockedBy columns)
    return (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date, outletName: outlet, itemKey } as any },
      update: { qty, buyPrice: buyPrice ?? 0, unit },
      create: { date, outletName: outlet, itemKey, qty, buyPrice: buyPrice ?? 0, unit },
    });
  }
}

export async function lockDay(input: unknown, actorCode: string) {
  const { date, outlet } = ZLockDayInput.parse(input);

  const lockKey = `lock:supply:${date}:${outlet}`;
  const existing = await (prisma as any).setting.findUnique({ where: { key: lockKey } });
  if (existing?.value?.locked) return existing;

  const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } });
  if (rows.length === 0) {
    const e: any = new Error("No rows to lock");
    e.code = 400;
    throw e;
  }

  const value = { locked: true, lockedAt: new Date().toISOString(), by: actorCode };
  const setting = await (prisma as any).setting.upsert({
    where: { key: lockKey },
    update: { value },
    create: { key: lockKey, value },
  });
  return setting;
}

export async function createTransfer(input: unknown) {
  const { date, fromOutlet, toOutlet, itemKey, qty, unit } = ZTransferInput.parse(input);
  if (fromOutlet === toOutlet) {
    const e: any = new Error("From/To must differ");
    e.code = 400;
    throw e;
  }
  const prod = await (prisma as any).product.findUnique({ where: { key: itemKey } });
  if (!prod || prod.unit !== unit) throw new Error("Invalid product/unit");

  const t = await (prisma as any).supplyTransfer.create({
    data: { date, fromOutletName: fromOutlet, toOutletName: toOutlet, itemKey, qty, unit },
  });
  return t;
}

export async function createDispute(input: unknown, actorCode: string) {
  const { date, outlet, itemKey, qty, reason, evidenceUrls } = ZDisputeInput.parse(input);
  const item = await (prisma as any).product.findUnique({ where: { key: itemKey } });
  if (!item) throw new Error("Unknown product");

  const ri = await (prisma as any).reviewItem.create({
    data: {
      type: "dispute",
      outlet,
      date: new Date(date + "T00:00:00.000Z"),
      payload: { itemKey, qty, reason, evidenceUrls, by: actorCode },
      status: "pending",
    },
  });
  return ri;
}

export async function requestEdit(input: unknown, actorCode: string) {
  const { date, outlet, rows, reason } = ZRequestEditInput.parse(input);
  const ri = await (prisma as any).reviewItem.create({
    data: {
      type: "supply_edit",
      outlet,
      date: new Date(date + "T00:00:00.000Z"),
      payload: { rows, reason, by: actorCode },
      status: "pending",
    },
  });
  return ri;
}

// Lightweight daily JSON report
export async function buildReportJSON(date: string, outlet: string) {
  const [snapshot, products] = await Promise.all([
    getDaySnapshot(date, outlet),
    listProductsForOutlet(outlet),
  ]);
  // Map name/unit for readability
  const pmap = new Map(products.map((p: any) => [p.key, p]));
  const rows = snapshot.rows.map((r: any) => ({
    itemKey: r.itemKey,
    name: (pmap.get(r.itemKey) as any)?.name ?? r.itemKey,
    unit: r.unit,
    buyPrice: r.buyPrice,
    qty: r.qty,
  }));
  return {
    date,
    outlet,
    isLocked: snapshot.isLocked,
    opening: rows,
    transfers: snapshot.transfers,
    disputesOpenOrApproved: snapshot.disputes,
  };
}

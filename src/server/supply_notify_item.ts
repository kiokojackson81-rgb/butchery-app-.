import { prisma } from "@/lib/prisma";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/lib/wa_phone";
import { formatPerItemSupplyMessage } from "@/lib/wa_supply_item_format";
import { getSession } from "@/lib/session";
import { canonFull } from "@/lib/codeNormalize";

// Single-item notification to the attendant each time a single opening row is saved.
// Updated to the richer "Supply Received" template with OK/1 guidance.

const num2 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
function fmtQty(v: number) { return num2.format(Number.isFinite(v) ? v : 0); }
function shillings(v: number) { return num0.format(Math.round(Number.isFinite(v) ? v : 0)); }

export async function notifySupplyItem(opts: { outlet: string; date: string; itemKey: string; supplierCode?: string | null; supplierName?: string | null }) {
  const outlet = opts.outlet.trim();
  if (!outlet) return { ok: false, reason: "no-outlet" };
  const date = opts.date.slice(0, 10);
  const itemKey = opts.itemKey.trim();
  if (!itemKey) return { ok: false, reason: "no-item" };

  // Today's rows (for index and today's cumulative qty)
  const rows = await (prisma as any).supplyOpeningRow.findMany({
    where: { outletName: outlet, date },
    orderBy: { id: "asc" },
  });
  if (!rows.length) return { ok: false, reason: "no-rows" };
  const idx = rows.findIndex((r: any) => r.itemKey === itemKey);
  if (idx === -1) return { ok: false, reason: "not-found" };
  const row = rows[idx];
  const position = idx + 1;
  const total = rows.length;

  // Recipient phone (attendant for outlet)
  const attendant = await (prisma as any).phoneMapping.findFirst({ where: { role: "attendant", outlet }, select: { phoneE164: true } });
  if (!attendant?.phoneE164) return { ok: false, reason: "no-attendant-phone" };

  // Product details (name + unit)
  const product = await (prisma as any).product.findUnique({ where: { key: itemKey } }).catch(() => null);
  const productName = String(product?.name || row.itemKey);
  const unit = String(row.unit || product?.unit || "kg");

  // Supplied today (cumulative for the day)
  const supplyQty = Number(row.qty || 0);

  // Opening stock = yesterday closing (for this product)
  const y = new Date(date + "T00:00:00.000Z");
  const yStr = new Date(y.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prev = await (prisma as any).attendantClosing.findUnique({
    where: { date_outletName_itemKey: { date: yStr, outletName: outlet, itemKey } },
  }).catch(() => null);
  const openingQty = Number(prev?.closingQty || 0);

  // Total stock after today supply
  const totalQty = openingQty + supplyQty;

  // Selling price per unit from pricebook (optional)
  const pb = await (prisma as any).pricebookRow.findUnique({
    where: { outletName_productKey: { outletName: outlet, productKey: itemKey } },
  }).catch(() => null);
  const sellPrice = Number(pb?.sellPrice || 0);
  const expectedTotalValue = sellPrice > 0 ? totalQty * sellPrice : 0;

  // Date/Time formatting (KE locale)
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "2-digit" });
  const timeStr = now.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

  // Resolve attendant name from session cookie if present (best-effort)
  let attendantName: string | undefined = undefined;
  try {
    const sess: any = await getSession().catch(() => null);
    attendantName = sess?.attendant?.name || undefined;
  } catch {}

  // Resolve supplier name from provided options (supplierName > supplierCode -> PersonCode.name)
  let supplierName: string | undefined = undefined;
  try {
    if (opts.supplierName && String(opts.supplierName).trim()) {
      supplierName = String(opts.supplierName).trim();
    } else if (opts.supplierCode && String(opts.supplierCode).trim()) {
      const raw = String(opts.supplierCode).trim();
      const code = canonFull(raw);
      const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: code, mode: "insensitive" }, active: true } }).catch(() => null);
      supplierName = (pc?.name || undefined);
    } else {
      // Fallback: try the most recent supplier WA session for this outlet in the last 30 minutes
      try {
        const since = new Date(Date.now() - 30 * 60 * 1000);
        const suppSess = await (prisma as any).waSession.findFirst({
          where: { role: "supplier", outlet: outlet, updatedAt: { gte: since } },
          orderBy: { updatedAt: "desc" },
          select: { phoneE164: true },
        });
        if (suppSess?.phoneE164) {
          const pm = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164: suppSess.phoneE164, role: "supplier" } }).catch(() => null);
          if (pm?.code) {
            const pc2 = await (prisma as any).personCode.findFirst({ where: { code: { equals: canonFull(pm.code), mode: "insensitive" }, active: true } }).catch(() => null);
            supplierName = pc2?.name || undefined;
          }
        }
      } catch {}
    }
  } catch {}

  // Compose message via shared formatter
  const text = formatPerItemSupplyMessage({
    outletName: outlet,
    date: now,
    productName,
    unit,
    supplyQty,
    openingQty,
    sellPricePerUnit: sellPrice || undefined,
    attendantName,
    supplierName,
  });
  // Keep internal indexing stable (D<index>) even if we don't display it explicitly.
  // msg.push(`(Ref: D${position}/${total})`);

  try {
  await sendOpsMessage(toGraphPhone(attendant.phoneE164), { kind: "free_text", text });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

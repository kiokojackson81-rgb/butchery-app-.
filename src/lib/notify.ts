import { prisma } from "@/lib/db";
import { getPhoneByCode, sendTemplate } from "@/lib/wa";

/** Notify supervisor about low stock */
export async function notifyLowStock(outlet: string, product: string, qty: string) {
  const supPhone = await getPhoneByCode({ role: "supervisor", outlet });
  if (!supPhone) return;
  await sendTemplate({ to: supPhone, template: "low_stock_alert", params: [product, outlet, qty] });
}

/** Notify supplier that supply was received */
export async function notifySupplyReceived(supplierCode: string, product: string, qtyLabel: string) {
  const phone = await getPhoneByCode({ role: "supplier", code: supplierCode });
  if (!phone) return;
  await sendTemplate({ to: phone, template: "supply_received", params: [supplierCode, product, qtyLabel] });
}

/** Notify attendant closing submission completed */
export async function notifyClosingSubmitted(attendantCode: string, expectedKsh: number) {
  const phone = await getPhoneByCode({ role: "attendant", code: attendantCode });
  if (!phone) return;
  await sendTemplate({ to: phone, template: "closing_stock_submitted", params: [attendantCode, String(expectedKsh)] });
}

/** Notify attendant waste rejected */
export async function notifyWasteRejected(attendantCode: string, qty: string, reason: string) {
  const phone = await getPhoneByCode({ role: "attendant", code: attendantCode });
  if (!phone) return;
  await sendTemplate({ to: phone, template: "waste_rejected", params: [attendantCode, qty, reason] });
}

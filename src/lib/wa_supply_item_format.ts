// Pure formatter for per-item supply messages sent to attendants.
// Keeps all computation outside of DB/IO so it can be unit-tested.

const num2 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
function fmtQty(v: number) { return num2.format(Number.isFinite(v) ? v : 0); }
function shill(v: number) { return num0.format(Math.round(Number.isFinite(v) ? v : 0)); }

export type PerItemMessageInput = {
  outletName: string;
  date: Date; // when message created
  productName: string;
  unit: string; // e.g., kg
  supplyQty: number;
  openingQty: number;
  sellPricePerUnit?: number; // optional (from pricebook)
  attendantName?: string; // optional
  supplierName?: string; // optional
};

export function formatPerItemSupplyMessage(i: PerItemMessageInput): string {
  const totalQty = (Number(i.openingQty || 0) + Number(i.supplyQty || 0));
  const dateStr = i.date.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "2-digit" });
  const timeStr = i.date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  const lines: string[] = [];
  lines.push(`🧾 Supply Received — ${i.outletName}`);
  lines.push("");
  lines.push(`📅 Date: ${dateStr} ⏰ Time: ${timeStr}`);
  lines.push("");
  lines.push(`🛒 Product: ${i.productName}`);
  lines.push(`📦 Supplied: ${fmtQty(i.supplyQty)}${i.unit}`);
  lines.push(`🔁 Opening stock: ${fmtQty(i.openingQty)}${i.unit}`);
  lines.push(`📊 Total stock (Opening + Supply): ${fmtQty(totalQty)}${i.unit}`);
  if (i.sellPricePerUnit && i.sellPricePerUnit > 0) {
    const expected = totalQty * i.sellPricePerUnit;
    lines.push("");
    lines.push(`💰 Price per ${i.unit}: Ksh ${shill(i.sellPricePerUnit)}`);
    lines.push(`🧮 Expected total value: Ksh ${shill(expected)}`);
    lines.push(`*(= (openingQty + supplyQty) × price per ${i.unit})*`);
  }
  lines.push("");
  lines.push(`👨‍🍳 Received by: ${i.attendantName || "Attendant"}`);
  lines.push(`🚚 Delivered by: ${i.supplierName || "Supplier"}`);
  lines.push("");
  lines.push(`✅ Reply "OK" to confirm and add this quantity to today’s opening stock.`);
  lines.push(`⚠️ If the quantity or price is incorrect, reply "1" to start a dispute. You will be guided to enter your expected quantity and describe the issue.`);
  lines.push(`*(Unconfirmed supplies lock after 24 hours.)*`);
  return lines.join("\n");
}

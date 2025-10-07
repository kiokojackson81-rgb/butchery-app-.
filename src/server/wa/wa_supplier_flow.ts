// server/wa/wa_supplier_flow.ts
import { prisma } from "@/lib/prisma";
import { sendText, sendInteractive } from "@/lib/wa";
import { toGraphPhone } from "@/lib/wa_phone";
import {
  buildSupplierMenu,
  buildOutletList,
  buildProductList,
  buildBackCancel,
  buildAfterSaveButtons,
} from "@/server/wa/wa_messages";

export type SupplierState =
  | "SPL_MENU"
  | "SPL_DELIV_PICK_OUTLET"
  | "SPL_DELIV_PICK_PRODUCT"
  | "SPL_DELIV_QTY"
  | "SPL_DELIV_PRICE"
  | "SPL_DELIV_UNIT"
  | "SPL_DELIV_CONFIRM"
  | "SPL_TRANSFER_FROM"
  | "SPL_TRANSFER_TO"
  | "SPL_TRANSFER_PRODUCT"
  | "SPL_TRANSFER_QTY"
  | "SPL_TRANSFER_UNIT"
  | "SPL_RECENT"
  | "SPL_MOD_OUTLET"
  | "SPL_MOD_NOTE"
  | "SPL_DISPUTE_TOPIC"
  | "SPL_DISPUTE_NOTE";

export type SupplierCursor = {
  date: string;
  outlet?: string;
  productKey?: string;
  qty?: number;
  buyPrice?: number;
  unit?: "kg" | "pcs";
  fromOutlet?: string;
  toOutlet?: string;
};

const TTL_MIN = Number(process.env.WA_SESSION_TTL_MIN || 120);

function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isSessionValid(sess: any) {
  if (!sess?.code || sess.role !== "supplier") return false;
  const updatedAt = new Date(sess.updatedAt).getTime();
  const maxIdle = TTL_MIN * 60 * 1000;
  return Date.now() - updatedAt <= maxIdle;
}

async function sendLoginLink(phoneGraph: string) {
  // Minimal login hint; the login link sender is centralized elsewhere
  await sendText(phoneGraph, "You're not logged in. Tap the login link we sent recently to continue.");
}

async function saveSessionPatch(sessId: string, patch: Partial<{ state: string; cursor: SupplierCursor }>) {
  await (prisma as any).waSession.update({ where: { id: sessId }, data: { ...patch } });
}

async function upsertOpeningLock(outlet: string, date: string) {
  const key = `opening_lock:${date}:${outlet}`;
  await (prisma as any).setting.upsert({
    where: { key },
    update: { value: { locked: true, outlet, date } },
    create: { key, value: { locked: true, outlet, date } },
  });
}

async function notifyAttendants(outlet: string, text: string) {
  const rows = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet } });
  for (const r of rows) {
    if (r.phoneE164) await sendText(toGraphPhone(r.phoneE164), text);
  }
}

async function notifySupervisorsAdmins(outlet: string, text: string) {
  const rows = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ["supervisor", "admin"] as any }, outlet } });
  for (const r of rows) {
    if (r.phoneE164) await sendText(toGraphPhone(r.phoneE164), text);
  }
}

function parseQty(t: string): number | null {
  const m = String(t || "").trim().match(/^\d+(?:\.\d{1,2})?$/);
  if (!m) return null;
  const num = Number(m[0]);
  if (!(num > 0 && num <= 9999)) return null;
  return num;
}

export async function handleSupplierAction(sess: any, replyId: string, phoneE164: string) {
  const gp = toGraphPhone(phoneE164);
  const today = todayLocalISO();

  if (!isSessionValid(sess)) return sendLoginLink(gp);

  switch (replyId) {
    case "SPL_DELIVER": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_OUTLET", cursor: { date: today } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any });
    }

    case "SPL_TRANSFER": {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_FROM", cursor: { date: today } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any });
    }

    case "SPL_RECENT": {
      const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date: today }, orderBy: { id: "desc" }, take: 5 });
      const lines = (rows || []).length
        ? rows.map((r: any) => `• ${r.outletName} — ${r.itemKey} ${r.qty}${r.unit} @ ${r.buyPrice}`).join("\n")
        : "No deliveries today.";
      await sendText(gp, lines);
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }
    case "SPL_DISPUTES": {
      // show recent disputes (today or last 3 days) for visibility
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      const items = await (prisma as any).reviewItem.findMany({ where: { type: { in: ["dispute", "supply_dispute"] as any }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10 });
      if (!items.length) {
        await sendText(gp, "No open disputes.");
      } else {
        const lines = items.map((i: any) => `• ${i.outlet} — ${new Date(i.date).toISOString().slice(0,10)} — ${(i.payload as any)?.reason || (i.payload as any)?.summary || ''}`.slice(0, 300)).join("\n");
        await sendText(gp, lines);
      }
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }

    case "SPL_BACK":
      return supplierGoBack(sess, gp);

    case "SPL_CANCEL":
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });

    case "SPL_LOCK": {
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      if (!c.outlet) {
        await sendText(gp, "Select an outlet first.");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
      }
      const cnt = await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: c.outlet } });
      if (!cnt) {
        await sendText(gp, "Add at least one item before locking.");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock: false }) as any });
      }
      await upsertOpeningLock(c.outlet, c.date);
      await notifyAttendants(c.outlet, `Opening stock is live for ${c.outlet} (${c.date}). Proceed with operations.`);
      await notifySupervisorsAdmins(c.outlet, `Delivery posted & locked for ${c.outlet} (${c.date}).`);
      await sendText(gp, `Opening locked for ${c.outlet} (${c.date}).`);
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }

    case "SPL_ADD_MORE": {
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any });
    }

    case "SPL_MENU":
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
  }

  // List and unit handlers
  if (replyId.startsWith("SPL_O:")) {
    const outlet = replyId.split(":")[1]!;
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    if (sess.state === "SPL_TRANSFER_FROM") {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_TO", cursor: { ...c, fromOutlet: outlet } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true, NOT: { name: outlet } }, select: { name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any });
    }
    if (sess.state === "SPL_TRANSFER_TO") {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_PRODUCT", cursor: { ...c, toOutlet: outlet } });
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any });
    }
    // Default: delivery -> next is pick product
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, outlet } });
    const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any });
  }

  if (replyId.startsWith("SPL_P:")) {
    const productKey = replyId.split(":")[1]!;
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_QTY", cursor: { ...c, productKey } });
    await sendText(gp, "Enter quantity (numbers only, e.g., 8 or 8.5)");
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
  }

  if (replyId === "UNIT_KG" || replyId === "UNIT_PCS") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const unit = replyId === "UNIT_KG" ? "kg" : "pcs";
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_CONFIRM", cursor: { ...c, unit } });
    const p = await (prisma as any).product.findUnique({ where: { key: c.productKey }, select: { name: true } });
    await sendText(gp, `Save delivery for ${c.outlet}: ${p?.name || c.productKey} ${c.qty}${unit} @ ${c.buyPrice}?`);
    return sendInteractive({
      messaging_product: "whatsapp",
      to: gp,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Confirm?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "SPL_SAVE", title: "Confirm" } },
            { type: "reply", reply: { id: "SPL_BACK", title: "Edit" } },
            { type: "reply", reply: { id: "SPL_CANCEL", title: "Cancel" } },
          ],
        },
      },
    } as any);
  }

  if (replyId === "SPL_SAVE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { outlet, productKey, qty, buyPrice, unit } = c;
    if (!outlet || !productKey || !qty || !buyPrice || !unit) {
      await sendText(gp, "Missing details; please try again.");
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }
    // If exists, prompt Add vs Replace
    const existed = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } } });
    if (existed) {
      await sendText(gp, `You've already submitted ${productKey} today for ${outlet}. Add to existing or Replace?`);
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_CONFIRM", cursor: { ...c } });
      return sendInteractive({
        messaging_product: "whatsapp",
        to: gp,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: `Existing ${productKey}: ${existed.qty}${existed.unit}. Choose action:` },
          action: {
            buttons: [
              { type: "reply", reply: { id: "SPL_SAVE_ADD", title: "Add" } },
              { type: "reply", reply: { id: "SPL_SAVE_REPLACE", title: "Replace" } },
              { type: "reply", reply: { id: "SPL_BACK", title: "Back" } },
            ],
          },
        },
      } as any);
    }
    await (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
      update: { qty, buyPrice, unit },
      create: { date: c.date, outletName: outlet, itemKey: productKey, qty, buyPrice, unit },
    });
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
    await sendText(gp, `Saved: ${productKey} ${qty}${unit} @ ${buyPrice} for ${outlet} (${c.date}).`);
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any });
  }

  if (replyId === "SPL_SAVE_ADD" || replyId === "SPL_SAVE_REPLACE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { outlet, productKey, qty, buyPrice, unit } = c;
    if (!outlet || !productKey || !qty || !buyPrice || !unit) {
      await sendText(gp, "Missing details; please try again.");
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }
    const existing = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } } });
    const existedQty = Number(existing?.qty || 0);
    const totalQty = replyId === "SPL_SAVE_ADD" ? existedQty + qty : qty;
    await (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
      update: { qty: totalQty, buyPrice, unit },
      create: { date: c.date, outletName: outlet, itemKey: productKey, qty: totalQty, buyPrice, unit },
    });
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
    await sendText(gp, `Saved: ${productKey} ${totalQty}${unit} total for ${outlet} (${c.date}).`);
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, qty: undefined, buyPrice: undefined, unit: undefined } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any });
  }

  // Default
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
}

export async function handleSupplierText(sess: any, text: string, phoneE164: string) {
  const gp = toGraphPhone(phoneE164);
  const today = todayLocalISO();
  if (!isSessionValid(sess)) return sendLoginLink(gp);

  switch (sess.state as SupplierState) {
    case "SPL_DELIV_QTY": {
      const num = parseQty(text);
      if (num == null) {
        await sendText(gp, "Numbers only, e.g., 8 or 8.5");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
      }
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PRICE", cursor: { ...c, qty: num } });
      await sendText(gp, "Enter buying price in Ksh (numbers only), e.g., 700");
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
    }
    case "SPL_DELIV_PRICE": {
      const price = parseInt(String(text || "").replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
        await sendText(gp, "Numbers only, e.g., 700");
        return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
      }
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_UNIT", cursor: { ...c, buyPrice: price } });
      return sendInteractive({
        messaging_product: "whatsapp",
        to: gp,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Pick unit:" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "UNIT_KG", title: "kg" } },
              { type: "reply", reply: { id: "UNIT_PCS", title: "pcs" } },
            ],
          },
        },
      } as any);
    }
    default:
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
  }
}

async function supplierGoBack(sess: any, gp: string) {
  const c: SupplierCursor = (sess.cursor as any) || { date: todayLocalISO() };
  switch (sess.state as SupplierState) {
    case "SPL_DELIV_QTY": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any });
    }
    case "SPL_DELIV_PRICE": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_QTY", cursor: { ...c } });
      await sendText(gp, "Enter quantity (numbers only, e.g., 8 or 8.5)");
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
    }
    case "SPL_DELIV_UNIT": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PRICE", cursor: { ...c } });
      await sendText(gp, "Enter buying price in Ksh (numbers only), e.g., 700");
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any });
    }
    case "SPL_DELIV_CONFIRM": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_UNIT", cursor: { ...c } });
      return sendInteractive({
        messaging_product: "whatsapp",
        to: gp,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Pick unit:" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "UNIT_KG", title: "kg" } },
              { type: "reply", reply: { id: "UNIT_PCS", title: "pcs" } },
            ],
          },
        },
      } as any);
    }
    case "SPL_DELIV_PICK_PRODUCT": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_OUTLET", cursor: { ...c } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any });
    }
    case "SPL_DELIV_PICK_OUTLET": {
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: todayLocalISO() } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }
    default: {
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: todayLocalISO() } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any });
    }
  }
}

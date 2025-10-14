// server/wa/wa_supplier_flow.ts
import { prisma } from "@/lib/prisma";
import { notifySupplyPosted } from "@/server/supply_notify";
import { sendTextSafe, sendInteractiveSafe, sendText, sendInteractive } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { toGraphPhone } from "@/lib/wa_phone";
import { createLoginLink } from "@/server/wa_links";
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
  await sendTextSafe(phoneGraph, "You're not logged in. Tap the login link we sent recently to continue.", "AI_DISPATCH_TEXT", { gpt_sent: true });
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
  if (r.phoneE164) await sendOpsMessage(toGraphPhone(r.phoneE164), { kind: "free_text", text });
  }
}

async function notifySupervisorsAdmins(outlet: string, text: string) {
  const rows = await (prisma as any).phoneMapping.findMany({ where: { role: { in: ["supervisor", "admin"] as any }, outlet } });
  for (const r of rows) {
  if (r.phoneE164) await sendOpsMessage(toGraphPhone(r.phoneE164), { kind: "free_text", text });
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
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SUPL_DELIVERY":
    case "SUPL_SUBMIT_DELIVERY": {
      // Start Submit Delivery flow. If supplier has only one assigned outlet, auto-select it.
      const assigned = await (prisma as any).phoneMapping.findMany({ where: { phoneE164: phoneE164, role: "supplier" } });
      // For compatibility, fallback to listing active outlets if assignments are not present
      let outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      // If only one outlet globally or in assignment, auto-select it and proceed to product pick
      if (assigned?.length === 1) {
        const outletName = assigned[0].outlet || outlets[0]?.name;
        await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { date: today, outlet: outletName } });
        // Suggest recent products for this outlet first
        const recent = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName, date: today }, orderBy: { id: "desc" }, take: 5, select: { itemKey: true } });
        const recentKeys = (recent || []).map((r: any) => r.itemKey);
        const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
        // Order products: recent first
        products.sort((a: any, b: any) => (recentKeys.indexOf(a.key) === -1 ? 1 : 0) - (recentKeys.indexOf(b.key) === -1 ? 1 : 0));
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
      }
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_OUTLET", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_TRANSFER":
    case "SUPL_TRANSFER": {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_FROM", cursor: { date: today } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_RECENT":
    case "SUPL_HISTORY": {
      const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date: today }, orderBy: { id: "desc" }, take: 5 });
      const lines = (rows || []).length
        ? rows.map((r: any) => `• ${r.outletName} — ${r.itemKey} ${r.qty}${r.unit} @ ${r.buyPrice}`).join("\n")
        : "No deliveries today.";
        await sendTextSafe(gp, lines, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }

  case "SPL_DISPUTES":
  case "SUPL_DISPUTES": {
      // show recent disputes (today or last 3 days) for visibility
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      const items = await (prisma as any).reviewItem.findMany({ where: { type: { in: ["dispute", "supply_dispute"] as any }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10 });
      if (!items.length) {
  await sendTextSafe(gp, "No open disputes.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      } else {
        const lines = items.map((i: any) => `• ${i.outlet} — ${new Date(i.date).toISOString().slice(0,10)} — ${(i.payload as any)?.reason || (i.payload as any)?.summary || ''}`.slice(0, 300)).join("\n");
        await sendTextSafe(gp, lines, "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_BACK":
      return supplierGoBack(sess, gp);

    case "LOGOUT": {
      // Clear session state and instruct user to login
      try { await (prisma as any).waSession.update({ where: { id: sess.id }, data: { state: 'LOGIN', code: null, outlet: null } }); } catch {}
      // Minimal single-message logout with link (no interactive follow-up)
      try {
        const urlObj = await createLoginLink(phoneE164);
        await sendTextSafe(gp, `You've been logged out. Tap this link to log in via the website:\n${urlObj.url}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      } catch {
        await sendTextSafe(gp, "You've been logged out.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
      return;
    }

    case "SPL_CANCEL":
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");

    case "SPL_LOCK": {
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      if (!c.outlet) {
        await sendTextSafe(gp, "Select an outlet first.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
      }
      const cnt = await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: c.outlet } });
      if (!cnt) {
        await sendTextSafe(gp, "Add at least one item before locking.", "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock: false }) as any }, "AI_DISPATCH_INTERACTIVE");
      }
      await upsertOpeningLock(c.outlet, c.date);
      await notifyAttendants(c.outlet, `Opening stock is live for ${c.outlet} (${c.date}). Proceed with operations.`);
      await notifySupervisorsAdmins(c.outlet, `Delivery posted & locked for ${c.outlet} (${c.date}).`);
      await sendTextSafe(gp, `Opening locked for ${c.outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_ADD_MORE": {
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_MENU":
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
  }

  // List and unit handlers
  if (replyId.startsWith("SPL_O:")) {
    const outlet = replyId.split(":")[1]!;
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    // If state was menu and this outlet selection came from a View Opening/View Stock intent,
    // callers will have set the session state accordingly. Default behavior: move to product pick.
    if (sess.state === "SPL_TRANSFER_FROM") {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_TO", cursor: { ...c, fromOutlet: outlet } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true, NOT: { name: outlet } }, select: { name: true } });
    return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    if (sess.state === "SPL_TRANSFER_TO") {
  await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_PRODUCT", cursor: { ...c, toOutlet: outlet } });
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    // Default: delivery -> next is pick product
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, outlet } });
    // Suggest recent products first for this outlet
    const recent = await (prisma as any).supplyOpeningRow.findMany({ where: { outletName: outlet, date: today }, orderBy: { id: "desc" }, take: 5, select: { itemKey: true } });
    const recentKeys = (recent || []).map((r: any) => r.itemKey);
    const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
    products.sort((a: any, b: any) => (recentKeys.indexOf(a.key) === -1 ? 1 : 0) - (recentKeys.indexOf(b.key) === -1 ? 1 : 0));
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId.startsWith("SPL_P:")) {
    const productKey = replyId.split(":")[1]!;
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    // If this product is new for the outlet (never submitted before) we ask for confirmation
    const outlet = c.outlet;
    if (outlet) {
      const existed = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: today, outletName: outlet, itemKey: productKey } } });
      if (!existed) {
        // Ask the supplier to confirm adding a new product to the outlet
        await saveSessionPatch(sess.id, { state: "SPL_DELIV_CONFIRM", cursor: { ...c, productKey } });
        await sendTextSafe(gp, `${productKey} has no prior record at ${outlet}. Is this a new delivery for today?`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: { type: "button", body: { text: "Confirm new product?" }, action: { buttons: [ { type: "reply", reply: { id: "SPL_CONFIRM_NEW", title: "Yes (New Delivery)" } }, { type: "reply", reply: { id: "SPL_SKIP_NEW", title: "No (Skip)" } }, { type: "reply", reply: { id: "SPL_CANCEL", title: "Cancel" } } ] } } as any }, "AI_DISPATCH_INTERACTIVE");
      }
    }
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_QTY", cursor: { ...c, productKey } });
  await sendTextSafe(gp, "Please enter the quantity (numbers only, e.g., 8 or 8.5)", "AI_DISPATCH_TEXT", { gpt_sent: true });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId === "UNIT_KG" || replyId === "UNIT_PCS") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const unit = replyId === "UNIT_KG" ? "kg" : "pcs";
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_CONFIRM", cursor: { ...c, unit } });
    const p = await (prisma as any).product.findUnique({ where: { key: c.productKey }, select: { name: true } });
  await sendTextSafe(gp, `Save delivery for ${c.outlet}: ${p?.name || c.productKey} ${c.qty}${unit} @ ${c.buyPrice}?`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    return sendInteractiveSafe({
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
    } as any, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId === "SPL_SAVE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { outlet, productKey, qty, buyPrice, unit } = c;
    if (!outlet || !productKey || !qty || !buyPrice || !unit) {
  await sendTextSafe(gp, "Missing details; please try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    // If exists, prompt Add vs Replace
    const existed = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } } });
    if (existed) {
      await sendText(gp, `You've already submitted ${productKey} today for ${outlet}. Add to existing or Replace?`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_CONFIRM", cursor: { ...c } });
      return sendInteractive({
        messaging_product: "whatsapp",
        to: gp,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: `Existing ${productKey}: ${existed.qty}${existed.unit}. Pick action:` },
          action: {
            buttons: [
              { type: "reply", reply: { id: "SPL_SAVE_ADD", title: "Add" } },
              { type: "reply", reply: { id: "SPL_SAVE_REPLACE", title: "Replace" } },
              { type: "reply", reply: { id: "SPL_BACK", title: "Back" } },
            ],
          },
        },
      } as any, "AI_DISPATCH_INTERACTIVE");
    }
    await (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
      update: { qty, buyPrice, unit },
      create: { date: c.date, outletName: outlet, itemKey: productKey, qty, buyPrice, unit },
    });
    // Auto-notify after every individual save (per request) regardless of config flags
    try { await notifySupplyPosted({ outletName: outlet, date: c.date, supplierCode: sess?.code || null }); } catch {}
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
  await sendTextSafe(gp, `Saved: ${productKey} ${qty}${unit} @ Ksh ${buyPrice} for ${outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId === "SPL_SAVE_ADD" || replyId === "SPL_SAVE_REPLACE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { outlet, productKey, qty, buyPrice, unit } = c;
    if (!outlet || !productKey || !qty || !buyPrice || !unit) {
  await sendTextSafe(gp, "Missing details; please try again.", "AI_DISPATCH_TEXT");
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    const existing = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } } });
    const existedQty = Number(existing?.qty || 0);
    const totalQty = replyId === "SPL_SAVE_ADD" ? existedQty + qty : qty;
    await (prisma as any).supplyOpeningRow.upsert({
      where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
      update: { qty: totalQty, buyPrice, unit },
      create: { date: c.date, outletName: outlet, itemKey: productKey, qty: totalQty, buyPrice, unit },
    });
    // Auto-notify after update/add aggregate
    try { await notifySupplyPosted({ outletName: outlet, date: c.date, supplierCode: sess?.code || null }); } catch {}
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
  await sendTextSafe(gp, `Saved: ${productKey} ${totalQty}${unit} total for ${outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, qty: undefined, buyPrice: undefined, unit: undefined } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  // Default
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
}

export async function handleSupplierText(sess: any, text: string, phoneE164: string) {
  const gp = toGraphPhone(phoneE164);
  const today = todayLocalISO();
  if (!isSessionValid(sess)) return sendLoginLink(gp);

  switch (sess.state as SupplierState) {
    case "SPL_DELIV_QTY": {
      const num = parseQty(text);
    if (num == null) {
  await sendTextSafe(gp, "Numbers only, e.g., 8 or 8.5", "AI_DISPATCH_TEXT");
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PRICE", cursor: { ...c, qty: num } });
  await sendTextSafe(gp, "Enter buying price in Ksh (numbers only), e.g., 700", "AI_DISPATCH_TEXT");
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_DELIV_PRICE": {
      const price = parseInt(String(text || "").replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
  await sendTextSafe(gp, "Numbers only, e.g., 700", "AI_DISPATCH_TEXT");
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_UNIT", cursor: { ...c, buyPrice: price } });
      return sendInteractiveSafe({
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
      } as any, "AI_DISPATCH_INTERACTIVE");
    }
    default:
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
  }
}

async function supplierGoBack(sess: any, gp: string) {
  const c: SupplierCursor = (sess.cursor as any) || { date: todayLocalISO() };
  switch (sess.state as SupplierState) {
    case "SPL_DELIV_QTY": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_DELIV_PRICE": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_QTY", cursor: { ...c } });
  await sendText(gp, "Enter quantity (numbers only, e.g., 8 or 8.5)", "AI_DISPATCH_TEXT", { gpt_sent: true });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_DELIV_UNIT": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PRICE", cursor: { ...c } });
  await sendText(gp, "Enter buying price in Ksh (numbers only), e.g., 700", "AI_DISPATCH_TEXT", { gpt_sent: true });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
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
      } as any, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_DELIV_PICK_PRODUCT": {
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_OUTLET", cursor: { ...c } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_DELIV_PICK_OUTLET": {
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: todayLocalISO() } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    default: {
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: todayLocalISO() } });
  return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
  }
}

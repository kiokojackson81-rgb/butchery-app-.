// server/wa/wa_supplier_flow.ts
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/lib/codeNormalize";
import { notifySupplyItem } from "@/server/supply_notify_item";
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
import { lockPeriod } from "@/server/trading_period";
import { notifyTransferCreated } from "@/server/supplier/supplier.notifications";
import { getTodaySupplySummary } from "@/server/supply";
import { listProductsForOutlet } from "@/server/supplier/supplier.service";

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
  | "SPL_TRANSFER_CONFIRM"
  | "SPL_VIEW_OPENING_PICK_OUTLET"
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
  lastSig?: string; // idempotency signature of last save (delivery)
  lastSigTs?: number;
  pricebookPending?: boolean;
  stockPending?: boolean;
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

async function saveSessionPatch(sessId: string, patch: Partial<{ state: string; cursor: SupplierCursor; outlet?: string }>) {
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
  // Accept inputs like "8", "8.5", "8,5", and trim whitespace.
  // Normalize comma decimal separators to dot, remove thousands separators (spaces or commas in thousands position),
  // then parse as a float. Allow up to 3 decimal places for flexibility (kg weights sometimes use 0.125 etc.).
  if (t == null) return null;
  let s = String(t).trim();
  if (!s) return null;
  // Replace comma decimal separators with dot when used like "5,6" (but avoid removing all commas blindly if someone uses thousands)
  // Heuristic: if there's exactly one comma and no dots, treat comma as decimal separator. Otherwise drop common thousands separators (spaces, or commas between groups).
  const hasDot = s.indexOf('.') !== -1;
  const commaCount = (s.match(/,/g) || []).length;
  if (!hasDot && commaCount === 1) {
    s = s.replace(',', '.');
  } else {
    // remove spaces used as thousand separators and remove commas that look like thousand separators
    s = s.replace(/\s+/g, '').replace(/,/g, '');
  }
  // Allow only digits and a single dot plus up to 3 decimals
  const m = s.match(/^\d+(?:\.\d{1,3})?$/);
  if (!m) return null;
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
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
        await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { date: today, outlet: outletName }, outlet: outletName });
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

    case "SUPL_VIEW_OPENING": {
      // View opening summary; if only one assigned outlet, auto-display
      const assigned = await (prisma as any).phoneMapping.findMany({ where: { phoneE164, role: "supplier" }, select: { outlet: true } });
      const activeOutlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
  const outletNames = assigned.length ? assigned.map((a: any) => a.outlet).filter(Boolean) : activeOutlets.map((o: any) => o.name);
      if (outletNames.length === 1) {
        const out = outletNames[0]!;
        const rows = await getTodaySupplySummary(out, today);
        const lines = rows.length ? rows.map(r => `• ${r.name} ${r.qty}${r.unit} @ ${r.buyPrice || 0}`).join("\n").slice(0, 900) : "No opening rows yet.";
        await sendTextSafe(gp, `Opening — ${out} (${today})\n${lines}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
      }
      // Pick outlet first
      await saveSessionPatch(sess.id, { state: "SPL_VIEW_OPENING_PICK_OUTLET", cursor: { date: today, pricebookPending: true } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(activeOutlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SUPL_PRICEBOOK": {
      // Show price list (sell price) per outlet. For now: require outlet pick if >1 assigned.
      const assigned = await (prisma as any).phoneMapping.findMany({ where: { phoneE164, role: "supplier" }, select: { outlet: true } });
      const activeOutlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      const outletNames = assigned.length ? assigned.map((a: any) => a.outlet).filter(Boolean) : activeOutlets.map((o: any) => o.name);
      const chosen = outletNames.length === 1 ? outletNames[0] : null;
      if (!chosen) {
        await saveSessionPatch(sess.id, { state: "SPL_VIEW_OPENING_PICK_OUTLET", cursor: { date: today } }); // reuse outlet pick state
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(activeOutlets) as any }, "AI_DISPATCH_INTERACTIVE");
      }
      const products = await listProductsForOutlet(chosen);
      const lines = products.slice(0, 40).map((p: any) => `• ${p.name} — sell ${p.sellPrice ?? "?"}${p.unit}`).join("\n").slice(0, 900) || "No products.";
      await sendTextSafe(gp, `Price List — ${chosen} (${today})\n${lines}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }

    case "SPL_RECENT":
    case "SUPL_HISTORY": {
      const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date: today }, orderBy: { id: "desc" }, take: 5 });
      const lines = (rows || []).length
        ? rows.map((r: any) => `• ${r.outletName} — ${r.itemKey} ${r.qty}${r.unit} @ ${r.buyPrice}`).join("\n")
        : "No deliveries today.";
        await sendTextSafe(gp, lines, "AI_DISPATCH_TEXT", { gpt_sent: true });
      // Offer delete options if there are rows (single-item delete for now)
      if ((rows || []).length) {
        const buttons = rows.slice(0,3).map((r: any) => ({ type: "reply", reply: { id: `SPL_DEL_ROW:${r.id}`, title: `Del ${r.itemKey}` } }));
        buttons.push({ type: "reply", reply: { id: "SPL_MENU", title: "Menu" } });
        await sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: { type: "button", body: { text: "Delete an item?" }, action: { buttons } } as any }, "AI_DISPATCH_INTERACTIVE");
        return;
      }
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
      // Also lock the trading period for attendants so dashboard/attendant behavior is consistent
      try {
        await lockPeriod(c.outlet, c.date, sess.code || "supplier");
      } catch (err) {
        // best-effort: don't block supplier flow on lock errors
      }
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

    case "SUPL_VIEW_STOCK": {
      // For now, reuse opening summary as a proxy for stock. Future: compute from day totals.
      const assigned = await (prisma as any).phoneMapping.findMany({ where: { phoneE164, role: "supplier" }, select: { outlet: true } });
      const activeOutlets = await (prisma as any).outlet.findMany({ where: { active: true }, select: { name: true } });
      const outletNames = assigned.length ? assigned.map((a: any) => a.outlet).filter(Boolean) : activeOutlets.map((o: any) => o.name);
      if (outletNames.length === 1) {
        const out = outletNames[0]!;
        const rows = await getTodaySupplySummary(out, today);
        const lines = rows.length ? rows.map(r => `• ${r.name} ${r.qty}${r.unit}`).join("\n").slice(0, 900) : "No stock rows yet.";
        await sendTextSafe(gp, `Stock — ${out} (${today})\n${lines}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
      }
      await saveSessionPatch(sess.id, { state: "SPL_VIEW_OPENING_PICK_OUTLET", cursor: { date: today, stockPending: true } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(activeOutlets) as any }, "AI_DISPATCH_INTERACTIVE");
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
    if (sess.state === "SPL_VIEW_OPENING_PICK_OUTLET") {
      // Display summary then return to menu
      const rows = await getTodaySupplySummary(outlet, c.date);
      const lines = rows.length ? rows.map(r => `• ${r.name} ${r.qty}${r.unit} @ ${r.buyPrice || 0}`).join("\n").slice(0, 900) : "No opening rows yet.";
      await sendTextSafe(gp, `Opening — ${outlet} (${c.date})\n${lines}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      // If previous action was pricebook pick reuse same state to show pricebook instead (heuristic: check lastSig for marker?)
      // Simplicity: if the user selected an outlet after SUPL_PRICEBOOK (state reused), also send pricebook.
      if ((sess.cursor as any)?.pricebookPending) {
        try {
          const products = await listProductsForOutlet(outlet);
          const linesPb = products.slice(0, 40).map((p: any) => `• ${p.name} — sell ${p.sellPrice ?? "?"}${p.unit}`).join("\n").slice(0, 900) || "No products.";
          await sendTextSafe(gp, `Price List — ${outlet} (${c.date})\n${linesPb}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        } catch {}
      }
      else if ((sess.cursor as any)?.stockPending) {
        try {
          const rows = await getTodaySupplySummary(outlet, c.date);
          const linesSt = rows.length ? rows.map(r => `• ${r.name} ${r.qty}${r.unit}`).join("\n").slice(0, 900) : "No stock rows yet.";
          await sendTextSafe(gp, `Stock — ${outlet} (${c.date})\n${linesSt}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
        } catch {}
      }
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
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
  await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, outlet }, outlet });
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
    if (sess.state === "SPL_TRANSFER_PRODUCT") {
      // Transfer flow: go to qty entry directly
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_QTY", cursor: { ...c, productKey } });
      await sendTextSafe(gp, "Enter quantity to transfer (numbers only)", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
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
    // Distinguish between delivery vs transfer confirm
    if (sess.state === "SPL_TRANSFER_UNIT" || sess.state === "SPL_TRANSFER_QTY") {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_CONFIRM", cursor: { ...c, unit } });
      const p = await (prisma as any).product.findUnique({ where: { key: c.productKey }, select: { name: true } });
      await sendTextSafe(gp, `Confirm transfer: ${p?.name || c.productKey} ${c.qty}${unit} from ${c.fromOutlet} → ${c.toOutlet}?`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractiveSafe({
        messaging_product: "whatsapp",
        to: gp,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Confirm transfer?" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "SPL_TRANSFER_SAVE", title: "Confirm" } },
              { type: "reply", reply: { id: "SPL_BACK", title: "Edit" } },
              { type: "reply", reply: { id: "SPL_CANCEL", title: "Cancel" } },
            ],
          },
        },
      } as any, "AI_DISPATCH_INTERACTIVE");
    } else {
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
  }

  if (replyId === "SPL_SAVE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { outlet, productKey, qty, buyPrice, unit } = c;
    if (!outlet || !productKey || !qty || !buyPrice || !unit) {
  await sendTextSafe(gp, "Missing details; please try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    // Idempotency guard: if last signature matches and under 30s, do not apply again
    const sig = `${c.date}:${outlet}:${productKey}:${qty}:${buyPrice}:${unit}`;
    const now = Date.now();
    if (c.lastSig === sig && c.lastSigTs && now - c.lastSigTs < 30_000) {
      await sendTextSafe(gp, "Already saved (ignored duplicate).", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock: true }) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    // If exists, automatically ADD to current opening; otherwise create
    const existed = await (prisma as any).supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } } });
    if (existed) {
      await (prisma as any).supplyOpeningRow.update({
        where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
        data: { qty: { increment: qty }, buyPrice, unit },
      });
    } else {
      await (prisma as any).supplyOpeningRow.create({ data: { date: c.date, outletName: outlet, itemKey: productKey, qty, buyPrice, unit } });
    }
    try { await (prisma as any).waSession.update({ where: { id: sess.id }, data: { outlet } }); } catch {}
    // Resolve supplier identity (name) from session code or phone mapping and notify attendant
    let supplierName: string | undefined = undefined;
    let supplierCode: string | undefined = sess.code || undefined;
    try {
      if (supplierCode) {
        const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: canonFull(supplierCode), mode: "insensitive" }, active: true } });
        supplierName = pc?.name || undefined;
      }
      if (!supplierName) {
        const pm = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164, role: "supplier" } });
        if (pm?.code) {
          supplierCode = pm.code;
          const pc2 = await (prisma as any).personCode.findFirst({ where: { code: { equals: canonFull(pm.code), mode: "insensitive" }, active: true } });
          supplierName = pc2?.name || undefined;
        }
      }
    } catch {}
    // Auto-notify after every individual save (per request) regardless of config flags
    try { await notifySupplyItem({ outlet, date: c.date, itemKey: productKey!, supplierCode, supplierName }); } catch {}
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
  await sendTextSafe(gp, `Saved: ${productKey} ${qty}${unit} @ Ksh ${buyPrice} for ${outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, lastSig: sig, lastSigTs: now } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId === "SPL_TRANSFER_SAVE") {
    const c: SupplierCursor = (sess.cursor as any) || { date: today };
    const { fromOutlet, toOutlet, productKey, qty, unit } = c;
    if (!fromOutlet || !toOutlet || !productKey || !qty || !unit) {
      await sendTextSafe(gp, "Missing transfer details; please try again.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    if (fromOutlet === toOutlet) {
      await sendTextSafe(gp, "From/To must differ.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    // Transaction: record transfer + adjust openings
    try {
      await prisma.$transaction(async (tx: any) => {
        await tx.supplyTransfer.create({ data: { date: c.date, fromOutletName: fromOutlet, toOutletName: toOutlet, itemKey: productKey, qty, unit } });
        // decrement FROM
        const fromRow = await tx.supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: fromOutlet, itemKey: productKey } } });
        const fromQty = Math.max(0, (fromRow?.qty || 0) - qty);
        await tx.supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date: c.date, outletName: fromOutlet, itemKey: productKey } },
          create: { date: c.date, outletName: fromOutlet, itemKey: productKey, qty: fromQty, unit, buyPrice: fromRow?.buyPrice || 0 },
          update: { qty: fromQty },
        });
        // increment TO
        const toRow = await tx.supplyOpeningRow.findUnique({ where: { date_outletName_itemKey: { date: c.date, outletName: toOutlet, itemKey: productKey } } });
        const toQty = (toRow?.qty || 0) + qty;
        await tx.supplyOpeningRow.upsert({
          where: { date_outletName_itemKey: { date: c.date, outletName: toOutlet, itemKey: productKey } },
          create: { date: c.date, outletName: toOutlet, itemKey: productKey, qty: toQty, unit, buyPrice: toRow?.buyPrice || 0 },
          update: { qty: toQty },
        });
      });
      try { await notifyTransferCreated(fromOutlet, toOutlet, c.date, `${productKey} ${qty}${unit}`); } catch {}
      await sendTextSafe(gp, `Transfer saved: ${productKey} ${qty}${unit} ${fromOutlet} → ${toOutlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } catch (e: any) {
      await sendTextSafe(gp, `Failed to save transfer: ${String(e?.message || e)}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    await saveSessionPatch(sess.id, { state: "SPL_MENU", cursor: { date: today } });
    return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
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
    if (replyId === "SPL_SAVE_ADD") {
      if (existing) {
        await (prisma as any).supplyOpeningRow.update({
          where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
          data: { qty: { increment: qty }, buyPrice, unit },
        });
      } else {
        await (prisma as any).supplyOpeningRow.create({ data: { date: c.date, outletName: outlet, itemKey: productKey, qty, buyPrice, unit } });
      }
    } else { // SPL_SAVE_REPLACE
      await (prisma as any).supplyOpeningRow.upsert({
        where: { date_outletName_itemKey: { date: c.date, outletName: outlet, itemKey: productKey } },
        update: { qty, buyPrice, unit },
        create: { date: c.date, outletName: outlet, itemKey: productKey, qty, buyPrice, unit },
      });
    }
    try { await (prisma as any).waSession.update({ where: { id: sess.id }, data: { outlet } }); } catch {}
    // Resolve supplier identity (name) and notify attendant on update/add
    let supplierName: string | undefined = undefined;
    let supplierCode: string | undefined = sess.code || undefined;
    try {
      if (supplierCode) {
        const pc = await (prisma as any).personCode.findFirst({ where: { code: { equals: canonFull(supplierCode), mode: "insensitive" }, active: true } });
        supplierName = pc?.name || undefined;
      }
      if (!supplierName) {
        const pm = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164, role: "supplier" } });
        if (pm?.code) {
          supplierCode = pm.code;
          const pc2 = await (prisma as any).personCode.findFirst({ where: { code: { equals: canonFull(pm.code), mode: "insensitive" }, active: true } });
          supplierName = pc2?.name || undefined;
        }
      }
    } catch {}
    // Auto-notify after update/add aggregate
    try { await notifySupplyItem({ outlet, date: c.date, itemKey: productKey!, supplierCode, supplierName }); } catch {}
    const canLock = (await (prisma as any).supplyOpeningRow.count({ where: { date: c.date, outletName: outlet } })) > 0;
    if (replyId === "SPL_SAVE_ADD") {
      await sendTextSafe(gp, `Added: ${productKey} +${qty}${unit} for ${outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    } else {
      await sendTextSafe(gp, `Replaced: ${productKey} ${qty}${unit} total for ${outlet} (${c.date}).`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    await saveSessionPatch(sess.id, { state: "SPL_DELIV_PICK_PRODUCT", cursor: { ...c, qty: undefined, buyPrice: undefined, unit: undefined } });
  return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildAfterSaveButtons({ canLock }) as any }, "AI_DISPATCH_INTERACTIVE");
  }

  if (replyId.startsWith("SPL_DEL_ROW:")) {
    const id = replyId.split(":")[1];
    try {
      const row = await (prisma as any).supplyOpeningRow.findUnique({ where: { id: Number(id) } });
      if (!row) {
        await sendTextSafe(gp, "Row not found.", "AI_DISPATCH_TEXT", { gpt_sent: true });
      } else {
        await (prisma as any).supplyOpeningRow.delete({ where: { id: Number(id) } });
        await sendTextSafe(gp, `Deleted ${row.itemKey} ${row.qty}${row.unit} from ${row.outletName}.`, "AI_DISPATCH_TEXT", { gpt_sent: true });
      }
    } catch (e: any) {
      await sendTextSafe(gp, `Delete failed: ${String(e?.message || e)}`, "AI_DISPATCH_TEXT", { gpt_sent: true });
    }
    return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildSupplierMenu() as any }, "AI_DISPATCH_INTERACTIVE");
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
    case "SPL_TRANSFER_QTY": {
      const num = parseQty(text);
      if (num == null) {
        await sendTextSafe(gp, "Numbers only, e.g., 4 or 4.5", "AI_DISPATCH_TEXT");
        return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
      }
      const c: SupplierCursor = (sess.cursor as any) || { date: today };
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_UNIT", cursor: { ...c, qty: num } });
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
    case "SPL_TRANSFER_PRODUCT": {
      // Go back to choosing TO outlet
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_TO", cursor: { ...c } });
      const outlets = await (prisma as any).outlet.findMany({ where: { active: true, NOT: { name: c.fromOutlet } }, select: { name: true } });
      return sendInteractiveSafe({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildOutletList(outlets) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_TRANSFER_QTY": {
      // Back goes to product list again
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_PRODUCT", cursor: { ...c } });
      const products = await (prisma as any).product.findMany({ where: { active: true }, select: { key: true, name: true } });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildProductList(products) as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_TRANSFER_UNIT": {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_QTY", cursor: { ...c } });
      await sendText(gp, "Enter quantity to transfer (numbers only)", "AI_DISPATCH_TEXT", { gpt_sent: true });
      return sendInteractive({ messaging_product: "whatsapp", to: gp, type: "interactive", interactive: buildBackCancel() as any }, "AI_DISPATCH_INTERACTIVE");
    }
    case "SPL_TRANSFER_CONFIRM": {
      await saveSessionPatch(sess.id, { state: "SPL_TRANSFER_UNIT", cursor: { ...c } });
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

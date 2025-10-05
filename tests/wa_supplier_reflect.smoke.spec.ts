import { describe, it, expect } from "vitest";
import crypto from "crypto";

const ORIGIN = (() => {
  const b = process.env.BASE_URL || "https://barakafresh.com";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "https://barakafresh.com";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

function hmacHeader(secret: string, body: string) {
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

function todayISO() { return new Date().toISOString().slice(0,10); }
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

describe("WA supplier -> web reflect (live)", () => {
  it("submits a delivery via WA webhook and sees it via web API", async () => {
    if ((process.env.WA_DRY_RUN || "false").toLowerCase() === "true") {
      throw new Error("WA_DRY_RUN=true; set to false for live send");
    }

    const phone = process.env.TEST_WA_E164 || ""; // +E164
    const code = process.env.SUPPLIER_CODE || process.env.SUPPLIER_CODE || "";
    const appSecret = process.env.WHATSAPP_APP_SECRET || "";
    if (!phone || !code || !appSecret) throw new Error("Missing TEST_WA_E164 or SUPPLIER_CODE or WHATSAPP_APP_SECRET");

    // 1) Login supplier (start) so PhoneMapping/WaSession exist
    const start = await j(U("/api/wa/auth/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, wa: phone })
    });
    expect(start.status).toBeLessThan(500);

    // 2) Discover an outlet and a product
    let outlet = "";
    const ol = await j(U("/api/outlets"));
    const outlets = (ol as any).json?.rows || (ol as any).json || [];
    outlet = (outlets[0]?.name || outlets[0]?.outlet || outlets[0]?.code || "").toString();
    if (!outlet) throw new Error("No outlet found");

    let productKey = "";
    const sp = await j(U("/api/supplier/products"));
    const plist = (sp as any).json?.rows || (sp as any).json || [];
    productKey = (plist[0]?.key || plist[0]?.productKey || plist[0] || "beef").toString();
    if (!productKey) productKey = "beef";

    const fromGraph = phone.replace(/^\+/, "");

    async function postWebhook(obj: any) {
      const body = JSON.stringify(obj);
      const sig = hmacHeader(appSecret, body);
      return await fetch(U("/api/wa/webhook"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
        body,
      });
    }

    function wbInteractive(id: string) {
      return {
        entry: [{ changes: [{ value: { messages: [{ id: `wamid.${Date.now()}.${Math.random()}`, from: fromGraph, type: "interactive", interactive: { button_reply: { id, title: id } } }] } }] }],
      };
    }
    function wbText(text: string) {
      return {
        entry: [{ changes: [{ value: { messages: [{ id: `wamid.${Date.now()}.${Math.random()}`, from: fromGraph, type: "text", text: { body: text } }] } }] }],
      };
    }

    // 3) Drive the supplier flow: Deliver -> Outlet -> Product -> qty -> price -> unit -> save
    await postWebhook(wbInteractive("SPL_DELIVER"));
    await sleep(500);
    await postWebhook(wbInteractive(`SPL_O:${outlet}`));
    await sleep(500);
    await postWebhook(wbInteractive(`SPL_P:${productKey}`));
    await sleep(500);
    await postWebhook(wbText("2.5")); // qty
    await sleep(500);
    await postWebhook(wbText("700")); // price
    await sleep(500);
    await postWebhook(wbInteractive("UNIT_KG"));
    await sleep(500);
    const saveRes = await postWebhook(wbInteractive("SPL_SAVE"));
    expect(saveRes.status).toBeLessThan(500);
    await sleep(1000);

    // 4) Verify via web API (supplier day snapshot)
    const date = todayISO();
    async function checkOnce() {
      const r = await j(U(`/api/supplier/day?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet)}`));
      if ((r as any).json?.ok && (r as any).json?.data) {
        const rows = ((r as any).json.data?.opening || []) as any[];
        return rows.some(x => (x.itemKey === productKey || x.key === productKey) && Number(x.qty) > 0);
      }
      return false;
    }
    let ok = false;
    for (let i = 0; i < 8; i++) { // up to ~8s
      if (await checkOnce()) { ok = true; break; }
      await sleep(1000);
    }
    if (!ok) {
      // If duplicate existed, flow prompts Add/Replace; try Add and retry check
      await postWebhook(wbInteractive("SPL_SAVE_ADD"));
      await sleep(1500);
      ok = await checkOnce();
    }
    expect(ok).toBe(true);
  }, 90000);
});

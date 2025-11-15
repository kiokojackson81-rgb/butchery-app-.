import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Implementation is shared with GET helper
import { loadPrisma, upsertPricebookRow } from "../_shared";

/**
 * Test helper: upsert a PricebookRow. Hardened with better diagnostics so
 * Playwright failures surface root causes (e.g. missing migrations).
 */

export async function POST(req: Request) {
  // Guard: only allow in non-production or when WA_DRY_RUN=true
  const isProd = process.env.NODE_ENV === "production" && process.env.VERCEL === "1";
  const allow = !isProd || String(process.env.WA_DRY_RUN || "").toLowerCase() === "true";
  if (!allow) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Parse body with fallbacks: JSON → urlencoded → query params
  let body: any = null;
  const ctype = (req.headers as any).get?.("content-type") || "";
  try {
    body = await req.json();
  } catch {
    try {
      const txt = await req.text();
      if (txt && txt.trim().length > 0) {
        if (/application\/x-www-form-urlencoded/i.test(ctype)) {
          const p = new URLSearchParams(txt);
          body = Object.fromEntries(p.entries());
        } else {
          body = JSON.parse(txt);
        }
      }
    } catch {}
  }
  if (!body) {
    // As a last resort, read from query string to avoid 500s in test environments
    try {
      const url = new URL(req.url);
      body = {
        outletName: url.searchParams.get("outletName") || undefined,
        productKey: url.searchParams.get("productKey") || undefined,
        sellPrice: url.searchParams.get("sellPrice") || undefined,
        active: url.searchParams.get("active") || undefined,
      };
    } catch {}
  }

  // Lazy-load prisma
  let prisma: any;
  try {
    prisma = await loadPrisma();
  } catch (e: any) {
    const msg = String(e?.message || e || "error");
    console.error("[test/pricebook/upsert] prisma_import_failed", msg);
    return NextResponse.json({ ok: false, error: "prisma_import_failed:" + msg }, { status: 500 });
  }

  try {
    await upsertPricebookRow(prisma, {
      outletName: String(body?.outletName || "").trim(),
      productKey: String(body?.productKey || "").trim(),
      sellPrice: Number(body?.sellPrice ?? 0),
      active: Boolean(body?.active ?? true),
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "error");
    // Common root cause during local tests: missing migrations -> relation does not exist
    if (/pricebookrow/i.test(msg) && /relation/i.test(msg)) {
      console.error("[test/pricebook/upsert] table_missing", msg);
      return NextResponse.json({ ok: false, error: "pricebook_row_table_missing_run_migrations" }, { status: 500 });
    }
    console.error("[test/pricebook/upsert] error", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { APP_TZ, dateISOInTZ, addDaysISO } from "@/server/trading_period";
import { getSession } from "@/lib/session";

type Row = { date: string; outlet: string; itemKey: string; name: string; qty: number; unit: string; buyPrice: number };

function todayISO() { return dateISOInTZ(new Date(), APP_TZ); }
function dateNDaysAgoISO(days: number) { return addDaysISO(todayISO(), -days, APP_TZ); }

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(31, Number(searchParams.get("days") || 7)));
    const sort = (searchParams.get("sort") || "date_desc").toLowerCase();

    // Scope to attendant session if present
    const sess = await getSession().catch(() => null);

    let outletName: string | null = null;
    let productKeys: string[] = [];

    if (sess?.attendant?.loginCode) {
      const code = String((sess as any)?.attendant?.loginCode || "").trim();
      // Prefer AttendantScope
      const scope = await (prisma as any).attendantScope.findFirst({ where: { codeNorm: code }, include: { products: true } }).catch(() => null);
      if (scope) {
        outletName = String((scope as any).outletName || "").trim() || null;
        productKeys = Array.isArray((scope as any).products)
          ? ((scope as any).products as any[])
              .map((p: any) => String(p?.productKey || "").trim())
              .filter((k) => k.length > 0)
          : [];
      } else {
        const assignment = await (prisma as any).attendantAssignment.findUnique({ where: { code }, select: { outlet: true, productKeys: true } }).catch(() => null);
        outletName = String((assignment as any)?.outlet || "").trim() || null;
        productKeys = Array.isArray((assignment as any)?.productKeys)
          ? (((assignment as any).productKeys as any[]) || []).map((k) => String(k || "").trim()).filter(Boolean)
          : [];
      }
    }
    // Fallback: derive outlet from session outletRef/outletCode or allow an explicit ?outlet= when session exists
    if (!outletName && sess) {
      const outletFromSess = String((sess as any)?.attendant?.outletRef?.name || (sess as any)?.outletCode || "").trim();
      if (outletFromSess) outletName = outletFromSess;
      if (!outletName) {
        const outletQ = String(searchParams.get("outlet") || "").trim();
        if (outletQ) outletName = outletQ;
      }
    }

    if (!outletName) {
      // 401 in logs usually means the attendant session expired; dashboard will show empty history.
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const from = dateNDaysAgoISO(days - 1);
    const to = todayISO();

    // Query supply opening rows in range, restricted to attendant outlet and assigned products
    const where: any = {
      outletName,
      date: { gte: from, lte: to },
      ...(productKeys.length ? { itemKey: { in: productKeys } } : {}),
    };
    const rows = await (prisma as any).supplyOpeningRow.findMany({
      where,
      select: { date: true, outletName: true, itemKey: true, qty: true, unit: true, buyPrice: true },
    });

    // Resolve names and units
    const keys = Array.from(new Set(rows.map((r: any) => r.itemKey).filter(Boolean)));
    const products = keys.length ? await (prisma as any).product.findMany({ where: { key: { in: keys } } }) : [];
    const nameByKey = new Map<string, string>();
    const unitByKey = new Map<string, string>();
    for (const p of products as any[]) {
      if (p?.key) {
        nameByKey.set(p.key, p.name || p.key);
        unitByKey.set(p.key, p.unit || "kg");
      }
    }

    let list: Row[] = (rows as any[]).map((r) => ({
      date: r.date,
      outlet: r.outletName,
      itemKey: r.itemKey,
      name: nameByKey.get(r.itemKey) || r.itemKey,
      qty: Number(r.qty || 0),
      unit: String(r.unit || unitByKey.get(r.itemKey) || "kg"),
      buyPrice: Number(r.buyPrice || 0),
    }));

    // Sorting
    list.sort((a, b) => {
      switch (sort) {
        case "date_asc":
          return a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
        case "name_asc":
          return a.name.localeCompare(b.name) || b.date.localeCompare(a.date);
        case "name_desc":
          return b.name.localeCompare(a.name) || b.date.localeCompare(a.date);
        case "date_desc":
        default:
          return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
      }
    });

    return NextResponse.json({ ok: true, outlet: outletName, rows: list });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

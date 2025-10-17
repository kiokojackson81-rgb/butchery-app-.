import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

type Body = { key: string; target?: "before" | "after"; reason?: string };

function pick<T extends object>(obj: any, keys: string[]): Partial<T> {
  const out: any = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) { if (k in obj) out[k] = obj[k]; }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const key = String(body.key || "").trim();
    const target: "before" | "after" = (body.target === "after" ? "after" : "before");
    const reason = String(body.reason || "").trim();
    if (!key) return NextResponse.json({ ok: false, error: "missing key" }, { status: 400 });

    const row = await (prisma as any).setting.findUnique({ where: { key } }).catch(() => null);
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const val = (row as any).value || {};
    const [, , typeFromKey, idFromKey] = String(row.key).split(":");
    const type = String((val as any).type || typeFromKey || "").trim();
    const id = String((val as any).id || idFromKey || "").trim();
    if (!type || !id) return NextResponse.json({ ok: false, error: "invalid event payload" }, { status: 400 });

    const snap = (val as any)?.[target];
    if (!snap || typeof snap !== "object") return NextResponse.json({ ok: false, error: `no ${target} snapshot` }, { status: 400 });

    let table = "";
    let fields: string[] = [];
    switch (type) {
      case "opening":
        table = "supplyOpeningRow"; fields = ["qty", "unit", "buyPrice"]; break;
      case "deposit":
        table = "attendantDeposit"; fields = ["amount", "note", "status"]; break;
      case "expense":
        table = "attendantExpense"; fields = ["amount", "name"]; break;
      case "closing":
        table = "attendantClosing"; fields = ["closingQty", "wasteQty"]; break;
      default:
        return NextResponse.json({ ok: false, error: `unsupported type ${type}` }, { status: 400 });
    }

    const beforeNow = await (prisma as any)[table].findUnique({ where: { id } }).catch(() => null);
    if (!beforeNow) return NextResponse.json({ ok: false, error: "target row not found" }, { status: 404 });

    const data: any = pick<any>(snap, fields);
    const afterNow = await (prisma as any)[table].update({ where: { id }, data });

    // Log a new admin_edit audit with action: restore
    try {
      const auditKey = `admin_edit:${Date.now()}:${type}:${id}`;
      await (prisma as any).setting.create({
        data: { key: auditKey, value: { type, id, at: new Date().toISOString(), before: beforeNow, after: afterNow, action: "restore", from: target, sourceKey: key, reason: reason || undefined } },
      });
    } catch {}

    return NextResponse.json({ ok: true, type, id, target });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server" }, { status: 500 });
  }
}

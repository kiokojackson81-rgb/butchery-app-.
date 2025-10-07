import { prisma } from "@/lib/prisma";

let hasTypeColumn: boolean | null = null;

async function detectTypeColumn(): Promise<boolean> {
  if (hasTypeColumn !== null) return hasTypeColumn;
  try {
    const rows: Array<{ exists: boolean }> = await (prisma as any).$queryRawUnsafe(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'WaMessageLog' AND column_name = 'type'
       ) AS exists`
    );
    hasTypeColumn = Array.isArray(rows) && rows[0] && (rows[0] as any).exists === true;
  } catch {
    hasTypeColumn = false;
  }
  return hasTypeColumn;
}

export async function logMessage(entry: {
  attendantId?: string | null;
  direction?: "in" | "out";
  templateName?: string | null;
  payload: any;
  waMessageId?: string | null;
  status?: string | null;
  type?: string | null; // soft type; stored in payload.meta._type when column absent
  createdAt?: Date;
}) {
  try {
    const cols = ["attendantId", "direction", "templateName", "payload", "waMessageId", "status", "createdAt"] as string[];
    const vals: any[] = [
      entry.attendantId ?? null,
      entry.direction ?? "out",
      entry.templateName ?? null,
      entry.payload ?? {},
      entry.waMessageId ?? null,
      entry.status ?? null,
      entry.createdAt ?? new Date(),
    ];

    const hasType = await detectTypeColumn();
    let payload = entry.payload;
    if (!hasType && entry.type) {
      try {
        const p = payload && typeof payload === "object" ? { ...payload } : {};
        (p as any).meta = (p as any).meta || {};
        (p as any).meta._type = entry.type;
        payload = p;
        // replace payload in vals
        vals[3] = payload;
      } catch {}
    }

    if (hasType) {
      cols.splice(6, 0, "type");
      vals.splice(6, 0, entry.type ?? null);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO "public"."WaMessageLog" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`;
    // Use executeRaw with JSON parameter
    await (prisma as any).$executeRawUnsafe(sql, ...vals);
  } catch {}
}

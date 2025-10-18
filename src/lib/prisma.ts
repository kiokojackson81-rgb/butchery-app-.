// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

// We will export the extended client below
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = base as any;

// Hardening: Some environments may not yet have the `type` column on WaMessageLog,
// while the Prisma client generated from schema expects it in RETURNING.
// NOTE: In DRY/dev mode we disable all DB introspection and raw SQL to avoid timeouts.
// Also, when building the Next.js app (phase-production-build), do not touch the DB.

const DRY = (process.env.WA_DRY_RUN || "").toLowerCase() === "true" || process.env.NODE_ENV !== "production";
const SAFE_BUILD = String(process.env.NEXT_PHASE || "").includes("phase-production-build") || String(process.env.WA_BUILD_DRY || "").toLowerCase() === "true";
const NO_DB = DRY || SAFE_BUILD;

let __hasTypeColumn: boolean | null = null;
async function detectTypeColumn(): Promise<boolean> {
  if (NO_DB) return false;
  if (__hasTypeColumn !== null) return __hasTypeColumn;
  try {
    // Use the underlying base client during init to avoid referencing the exported prisma before it's created
    const rows: Array<{ exists: boolean }> = await (base as any).$queryRawUnsafe(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'WaMessageLog' AND column_name = 'type'
       ) AS exists`
    );
    __hasTypeColumn = Array.isArray(rows) && rows[0] && (rows[0] as any).exists === true;
  } catch {
    __hasTypeColumn = false;
  }
  return __hasTypeColumn;
}

const __original = {
  create: (base as any).waMessageLog?.create?.bind((base as any).waMessageLog),
  update: (base as any).waMessageLog?.update?.bind((base as any).waMessageLog),
};

// Override create with raw SQL insert that avoids RETURNING the missing column
try {
  if (!NO_DB) (base as any).waMessageLog.create = async (args: any) => {
    try {
      const data = (args && args.data) || {};
      const id = String(data.id || crypto.randomUUID());
      const cols: string[] = [
        "id",
        "attendantId",
        "direction",
        "templateName",
        "payload",
        "waMessageId",
        "status",
        "createdAt",
      ];
      const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
      const vals: any[] = [
        id,
        data.attendantId ?? null,
        data.direction ?? "out",
        data.templateName ?? null,
        data.payload ?? {},
        data.waMessageId ?? null,
        data.status ?? null,
        createdAt,
      ];
      const hasType = await detectTypeColumn();
      if (hasType) {
        cols.splice(8, 0, "type");
        vals.splice(8, 0, data.type ?? null);
      } else if (data.type) {
        try {
          const p = vals[4] && typeof vals[4] === "object" ? { ...(vals[4] as any) } : {};
          (p as any).meta = (p as any).meta || {};
          (p as any).meta._type = data.type;
          vals[4] = p;
        } catch {}
      }
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
      const sql = `INSERT INTO "public"."WaMessageLog" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`;
      await (base as any).$executeRawUnsafe(sql, ...vals);
      return { ok: true, id };
    } catch (e) {
      if (__original.create) return __original.create(args);
      throw e;
    }
  };
} catch {}

// Override update for the common case { where: { waMessageId }, data: { status } }
try {
  if (!NO_DB) (base as any).waMessageLog.update = async (args: any) => {
    const where = (args && args.where) || {};
    const data = (args && args.data) || {};
    if (where.waMessageId && typeof data.status !== "undefined") {
      try {
        await (base as any).$executeRawUnsafe(
          `UPDATE "public"."WaMessageLog" SET "status" = $1 WHERE "waMessageId" = $2`,
          data.status,
          where.waMessageId
        );
        return { ok: true };
      } catch {}
    }
    if (__original.update) return __original.update(args);
    return { ok: false };
  };
} catch {}

// Middleware safety net: intercept any WaMessageLog create/update and perform raw SQL
try {
  if (!NO_DB) (base as any).$use(async (params: any, next: any) => {
    if (params?.model === "WaMessageLog" && params?.action === "create") {
      try {
        const data = params.args?.data || {};
        const id = String(data.id || crypto.randomUUID());
        const cols: string[] = [
          "id",
          "attendantId",
          "direction",
          "templateName",
          "payload",
          "waMessageId",
          "status",
          "createdAt",
        ];
        const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        const vals: any[] = [
          id,
          data.attendantId ?? null,
          data.direction ?? "out",
          data.templateName ?? null,
          data.payload ?? {},
          data.waMessageId ?? null,
          data.status ?? null,
          createdAt,
        ];
        const hasType = await detectTypeColumn();
        if (hasType) {
          cols.splice(8, 0, "type");
          vals.splice(8, 0, data.type ?? null);
        } else if (data.type) {
          try {
            const p = vals[4] && typeof vals[4] === "object" ? { ...(vals[4] as any) } : {};
            (p as any).meta = (p as any).meta || {};
            (p as any).meta._type = data.type;
            vals[4] = p;
          } catch {}
        }
        const placeholders = cols.map((_: any, i: number) => `$${i + 1}`).join(",");
        const sql = `INSERT INTO "public"."WaMessageLog" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`;
        await (base as any).$executeRawUnsafe(sql, ...vals);
        return { ok: true, id };
      } catch {
        // If raw insert fails, fall back to normal path
        return next(params);
      }
    }
    if (params?.model === "WaMessageLog" && params?.action === "update") {
      const where = params?.args?.where || {};
      const data = params?.args?.data || {};
      if (where.waMessageId && typeof data.status !== "undefined") {
        try {
          await (base as any).$executeRawUnsafe(
            `UPDATE "public"."WaMessageLog" SET "status" = $1 WHERE "waMessageId" = $2`,
            data.status,
            where.waMessageId
          );
          return { ok: true };
        } catch {
          // fall through
        }
      }
    }
    return next(params);
  });
} catch {}

// Synchronous ensure: add the column early to avoid Prisma RETURNING errors in cold paths
try {
  if (!NO_DB) {
    const ok = await detectTypeColumn();
    if (!ok) {
      await (base as any).$executeRawUnsafe(
        'ALTER TABLE "public"."WaMessageLog" ADD COLUMN IF NOT EXISTS "type" TEXT'
      );
      __hasTypeColumn = true;
    }
  }
} catch {}

// Minimal test hook
// Use a unique export name to avoid HMR duplicate declaration collisions
export const __prismaTypeStore = { get hasType() { return __hasTypeColumn; } } as const;

// Strong interception via $extends so any usage of prisma.waMessageLog.create/update goes through our raw SQL
const prismaExtended = NO_DB ? base : (base as any).$extends({
  query: {
    waMessageLog: {
      async create({ args }: any) {
        try {
          if (NO_DB) return { ok: true } as any;
          const data = (args && args.data) || {};
          const id = String(data.id || crypto.randomUUID());
          const cols: string[] = [
            "id",
            "attendantId",
            "direction",
            "templateName",
            "payload",
            "waMessageId",
            "status",
            "createdAt",
          ];
          const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
          const vals: any[] = [
            id,
            data.attendantId ?? null,
            data.direction ?? "out",
            data.templateName ?? null,
            data.payload ?? {},
            data.waMessageId ?? null,
            data.status ?? null,
            createdAt,
          ];
          const hasType = await detectTypeColumn();
          let typeVal = data.type ?? null;
          if (hasType) {
            cols.splice(7, 0, "type");
            vals.splice(7, 0, typeVal);
          } else if (typeVal) {
            try {
              const p = vals[4] && typeof vals[4] === "object" ? { ...(vals[4] as any) } : {};
              (p as any).meta = (p as any).meta || {};
              (p as any).meta._type = typeVal;
              vals[4] = p;
            } catch {}
          }
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
          const sql = `INSERT INTO "public"."WaMessageLog" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`;
          await (base as any).$executeRawUnsafe(sql, ...vals);
          // Return a Prisma-like object
          return {
            id,
            attendantId: vals[1],
            direction: vals[2],
            templateName: vals[3],
            payload: vals[4],
            waMessageId: vals[5],
            status: vals[6],
            type: hasType ? typeVal : null,
            createdAt,
          };
        } catch (e) {
          if (__original.create) return __original.create(args);
          throw e;
        }
      },
      async update({ args }: any) {
        if (NO_DB) return { count: 0 } as any;
        const where = (args && args.where) || {};
        const data = (args && args.data) || {};
        if (where.waMessageId && typeof data.status !== "undefined") {
          try {
            await (base as any).$executeRawUnsafe(
              `UPDATE "public"."WaMessageLog" SET "status" = $1 WHERE "waMessageId" = $2`,
              data.status,
              where.waMessageId
            );
            return { count: 1 };
          } catch {}
        }
        if (__original.update) return __original.update(args);
        return { count: 0 };
      },
    },
  },
});

export const prisma = prismaExtended as PrismaClient;

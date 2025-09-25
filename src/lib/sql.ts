// src/lib/sql.ts
import { neon } from "@neondatabase/serverless";

/**
 * Uses pooled connection string in production.
 * Falls back to local .env if present.
 */
export const sql = neon(process.env.DATABASE_URL!);

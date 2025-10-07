// src/lib/ooc_guard.ts
import Ajv from "ajv";
// Using JSON import (tsconfig resolveJsonModule=true)
import schema from "./ooc.schema.json";

export type OOC = {
  intent: string;
  args?: Record<string, any>;
  buttons?: string[];
  next_state_hint?: string;
};

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema as any) as (data: any) => boolean & { errors?: any };

export type OOCCheck = { ok: true } | { ok: false; reason: string; details?: any };

export function validateOOC(ooc: any): OOCCheck {
  const required = (process.env.WA_OOC_REQUIRED ?? "true").toLowerCase() === "true";
  if (!ooc) return required ? { ok:false, reason:"missing_ooc" } : { ok:true };
  const ok = validate(ooc);
  if (!ok) {
    const errs = (validate as any).errors || [];
    return { ok: false, reason: "schema_invalid", details: errs.map((e: any) => ({ path: e.instancePath ?? e.dataPath, msg: e.message })) };
  }
  // Defense-in-depth quick guards
  const a = (ooc as any).args || {};
  if ("amount" in a && !(Number(a.amount) > 0)) return { ok:false, reason:"bad_amount" };
  if ("quantityKg" in a && !(Number(a.quantityKg) > 0)) return { ok:false, reason:"bad_qty" };
  if ("wasteKg" in a && !(Number(a.wasteKg) > 0)) return { ok:false, reason:"bad_waste" };
  if ("confirm" in a && typeof a.confirm !== "boolean") return { ok:false, reason:"bad_confirm" };
  return { ok: true };
}

export function sanitizeForLog(ooc: any) {
  try {
    const c = JSON.parse(JSON.stringify(ooc || {}));
    if (c?.args?.mpesaText) c.args.mpesaText = String(c.args.mpesaText).slice(0, 160);
    if (c?.args?.code) {
      const s = String(c.args.code);
      c.args.code = s.length > 5 ? `${s.slice(0,3)}***${s.slice(-2)}` : "***";
    }
    return c;
  } catch { return {}; }
}

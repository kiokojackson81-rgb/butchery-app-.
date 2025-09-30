/**
 * Normalize and verify PhoneMapping.phoneE164 values.
 *
 * - DB stores: +2547XXXXXXXX  (E.164 with plus)
 * - Graph send uses: 2547XXXXXXXX (no plus) – your send functions already normalize.
 *
 * Usage:
 *   npx tsx scripts/normalize-phones.ts
 *   npx tsx scripts/normalize-phones.ts --fix
 *   npx tsx scripts/normalize-phones.ts --verify
 *   npx tsx scripts/normalize-phones.ts --fix --verify
 *
 * Optional env for verify step:
 *   WHATSAPP_TOKEN=... (long-lived)
 *   WHATSAPP_PHONE_NUMBER_ID=849934581535490
 */

import { PrismaClient } from "@prisma/client";
import fetch from "node-fetch";

const prisma = new PrismaClient();

// ---- Config (Kenya) ----
const DEFAULT_COUNTRY_CODE = "254";
const KENYA_ALLOWED_PREFIXES = ["2547", "25410", "25411"]; // mobile & new ranges; expand if needed
const EXPECTED_LENGTH = 12; // e.g. 2547XXXXXXXX (12 digits)

/** Remove everything except digits and leading '+' */
function stripToDigitsPlus(input: string): string {
  if (!input) return "";
  let out = input.trim();
  // keep a leading + then digits
  const hasPlus = out.startsWith("+");
  out = out.replace(/[^\d+]/g, "");
  if (!hasPlus) out = out.replace(/[^\d]/g, "");
  return out;
}

/** Normalize any input to +2547XXXXXXXX (E.164 with plus) */
function normalizeToE164Plus(raw: string): { normalized: string; reason?: string } {
  if (!raw) return { normalized: "", reason: "empty" };
  let s = stripToDigitsPlus(raw);

  // Handle common cases
  // +2547XXXXXXXX  -> keep
  // 2547XXXXXXXX   -> add plus
  // 07XXXXXXXX     -> replace leading 0 with 254
  // 7XXXXXXXX      -> prefix 254
  if (s.startsWith("+")) s = s.slice(1); // remove plus to standardize

  if (s.startsWith(DEFAULT_COUNTRY_CODE)) {
    // ok
  } else if (s.startsWith("0")) {
    s = DEFAULT_COUNTRY_CODE + s.slice(1);
  } else if (s.length === 9 && s.startsWith("7")) {
    s = DEFAULT_COUNTRY_CODE + s;
  } else if (s.length === 10 && s.startsWith("07")) {
    s = DEFAULT_COUNTRY_CODE + s.slice(1);
  }

  // Validate shape now
  if (s.length !== EXPECTED_LENGTH) {
    return { normalized: "+" + s, reason: `bad_length_${s.length}` };
  }
  if (!KENYA_ALLOWED_PREFIXES.some((p) => s.startsWith(p))) {
    return { normalized: "+" + s, reason: "bad_prefix" };
  }
  if (!/^\d+$/.test(s)) {
    return { normalized: "+" + s, reason: "non_digit" };
  }

  return { normalized: "+" + s };
}

/** Convert +2547XXXXXXXX -> 2547XXXXXXXX for Graph sends (just strips +) */
function toGraphFormat(e164Plus: string): string {
  return (e164Plus || "").replace(/^\+/, "");
}

type VerifyOutcome = "WA_USER" | "NOT_WA" | "VERIFY_ERROR" | "SKIPPED";

async function verifyWithWhatsApp(graphNumber: string): Promise<VerifyOutcome> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return "SKIPPED";

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blocking: "wait",
        contacts: [graphNumber],
        force_check: true,
      }),
    });
    const json: any = await res.json();
    const status = json?.contacts?.[0]?.status;
    if (status === "valid") return "WA_USER";
    if (status === "invalid") return "NOT_WA";
    return "VERIFY_ERROR";
  } catch {
    return "VERIFY_ERROR";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const DO_FIX = args.includes("--fix");
  const DO_VERIFY = args.includes("--verify");

  const rows = await prisma.phoneMapping.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, code: true, role: true, phoneE164: true, outlet: true, updatedAt: true },
  });

  const header = [
    "id",
    "code",
    "role",
    "outlet",
    "current_phoneE164",
    "normalized_phoneE164",
    "graph_number",
    "valid_shape",
    "verify_result",
    "action",
  ].join(",");

  console.log(header);

  for (const r of rows) {
    const cur = r.phoneE164 || "";
    const { normalized, reason } = normalizeToE164Plus(cur);
    const graphNum = toGraphFormat(normalized);

    const validShape = reason ? `NO (${reason})` : "YES";
    let verify: VerifyOutcome = "SKIPPED";
    if (DO_VERIFY && !reason) {
      verify = await verifyWithWhatsApp(graphNum);
    }

    let action = "DRY_RUN";
    if (DO_FIX && normalized && normalized !== cur) {
      await prisma.phoneMapping.update({
        where: { id: r.id },
        data: { phoneE164: normalized, updatedAt: new Date() },
      });
      action = "UPDATED_DB";
    } else if (DO_FIX && (!normalized || reason)) {
      // Optionally, you could null invalids. We’ll leave as-is but flag them.
      action = "NEEDS_MANUAL_FIX";
    }

    console.log(
      [
        r.id,
        r.code || "",
        r.role || "",
        r.outlet || "",
        cur,
        normalized,
        graphNum,
        validShape,
        verify,
        action,
      ].join(",")
    );
  }

  console.log("\nTip:");
  console.log('- Use "--verify" to check if numbers are WhatsApp users (needs WHATSAPP_TOKEN & WHATSAPP_PHONE_NUMBER_ID).');
  console.log('- Use "--fix" to write normalized +254… back to DB.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

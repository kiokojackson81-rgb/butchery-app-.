#!/usr/bin/env tsx
// Dev helper: trigger supply + day-close WhatsApp notifications in DRY mode
// with logging enabled so you can verify WaMessageLog entries locally.

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { sendDayCloseNotifications } from "@/server/notifications/day_close";
import { notifySupplyPosted } from "@/server/supply_notify";

async function main() {
  // Force DRY logging so transport writes WaMessageLog rows
  process.env.WA_DRY_RUN = process.env.WA_DRY_RUN || "true";
  process.env.WA_LOG_DRY_RUN = "true";
  process.env.WA_AI_ENABLED = process.env.WA_AI_ENABLED || "true";
  process.env.WA_INTERACTIVE_ENABLED = process.env.WA_INTERACTIVE_ENABLED || "true";
  process.env.WA_GPT_ONLY = process.env.WA_GPT_ONLY || "true";

  const today = format(new Date(), "yyyy-MM-dd");
  // Pick an existing outlet if available; fallback to "MainOutlet"
  let outlet = "MainOutlet";
  try {
    const o = await (prisma as any).outlet.findFirst({ select: { name: true } });
    if (o?.name) outlet = String(o.name);
  } catch {}

  console.log("Using outlet:", outlet, "date:", today);

  try {
    console.log("-- Trigger: Supply Posted notify (multi-role)");
    const res1 = await notifySupplyPosted({ outletName: outlet, date: today, supplierCode: null });
    console.log("supply result:", JSON.stringify(res1));
  } catch (e: any) {
    console.warn("supply notify error:", String(e?.message || e));
  }

  try {
    console.log("-- Trigger: Day Close notify (multi-role)");
    await sendDayCloseNotifications({ date: today, outletName: outlet, attendantCode: null });
    console.log("day-close result: ok");
  } catch (e: any) {
    console.warn("day-close notify error:", String(e?.message || e));
  }

  // Optional hint to inspect logs for default admin fallback
  console.log("\nTip: Inspect DRY logs for +254705663175 (admin fallback):");
  console.log("  node scripts/inspect-wa-timeline.mjs +254705663175\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });

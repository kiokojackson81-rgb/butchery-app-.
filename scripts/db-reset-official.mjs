#!/usr/bin/env node
/**
 * scripts/db-reset-official.mjs
 *
 * Guarded database reset for loading official data.
 * - Default: wipe admin scaffolding only (codes/outlets/assignments/mirrors)
 * - With --all: also wipe operational rows (opening, transfers, closings, deposits, expenses, till, reviews, sessions, logs)
 *
 * SAFETY: Requires CONFIRM=WIPE env or --confirm WIPE.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv) {
  const flags = new Set();
  const kv = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const body = a.slice(2);
    if (body.includes("=")) {
      const [k, v] = body.split("=");
      kv[k] = v;
      continue;
    }
    // handle "--confirm WIPE" style
    if (body === "confirm" && typeof argv[i + 1] === "string" && !argv[i + 1].startsWith("--")) {
      kv.confirm = argv[i + 1];
      i++;
      continue;
    }
    if (body === "all") { flags.add("all"); continue; }
    flags.add(body);
  }
  return { flags, kv };
}

async function main() {
  const { flags, kv } = parseArgs(process.argv);
  const wantAll = flags.has("all") || kv.all === "true";
  const confirmVal = (process.env.CONFIRM || kv.confirm || "").toString().toUpperCase();
  const confirm = confirmVal === "WIPE";

  if (!confirm) {
    console.error("Refusing to reset: set CONFIRM=WIPE or pass --confirm WIPE");
    process.exit(2);
  }

  console.log("DB reset starting… scope:", wantAll ? "ALL" : "ADMIN-ONLY");

  // In all cases, stop any sessions first
  const results = {};

  // Admin-only wipe (codes/outlets/mappings/assignments/pricebook/scopes + mirrors)
  try {
    results.session = await prisma.session.deleteMany({});
    results.loginCode = await prisma.loginCode.deleteMany({});
    results.attendant = await prisma.attendant.deleteMany({});
    // Supervisors and Suppliers (admin people & codes cleanup)
    if (prisma.supervisor?.deleteMany) {
      results.supervisor = await prisma.supervisor.deleteMany({});
    }
    if (prisma.supplier?.deleteMany) {
      results.supplier = await prisma.supplier.deleteMany({});
    }

    // Scopes
    results.scopeProduct = await prisma.scopeProduct.deleteMany({});
    results.attendantScope = await prisma.attendantScope.deleteMany({});

    // Assignments and pricebook
    results.attendantAssignment = await prisma.attendantAssignment.deleteMany({});
    results.pricebookRow = await prisma.pricebookRow.deleteMany({});

    // Codes and phone mappings
    results.personCode = await prisma.personCode.deleteMany({});
    results.phoneMapping = await prisma.phoneMapping.deleteMany({});

    // Active period and settings/appstate mirrors
    results.activePeriod = await prisma.activePeriod.deleteMany({});
    results.settingMirrors = await prisma.setting.deleteMany({
      where: { key: { in: [
        "admin_outlets",
        "admin_codes",
        "attendant_scope",
        "admin_pricebook",
      ] } },
    });
    results.appStateMirrors = await prisma.appState.deleteMany({
      where: { key: { in: [
        "admin_outlets",
        "admin_codes",
        "attendant_scope",
        "admin_pricebook",
      ] } },
    });

    // Finally, outlets
    results.outlet = await prisma.outlet.deleteMany({});
  } catch (e) {
    console.error("Admin wipe failed:", e?.message || e);
    process.exit(1);
  }

  if (wantAll) {
    try {
      // Operational rows
      results.supplyOpeningRow = await prisma.supplyOpeningRow.deleteMany({});
      results.supplyTransfer = await prisma.supplyTransfer.deleteMany({});
      results.attendantClosing = await prisma.attendantClosing.deleteMany({});
      results.attendantDeposit = await prisma.attendantDeposit.deleteMany({});
      results.attendantExpense = await prisma.attendantExpense.deleteMany({});
      results.attendantTillCount = await prisma.attendantTillCount.deleteMany({});
      results.reviewItem = await prisma.reviewItem.deleteMany({});
      results.supplyRequest = await prisma.supplyRequest.deleteMany({});
      // WhatsApp logs/sessions
      results.waMessageLog = await prisma.waMessageLog.deleteMany({});
      results.waSession = await prisma.waSession.deleteMany({});
      // Settings and AppState catch-all (wipe everything)
      results.settingsAll = await prisma.setting.deleteMany({});
      results.appStateAll = await prisma.appState.deleteMany({});
    } catch (e) {
      console.error("Full wipe failed:", e?.message || e);
      process.exit(1);
    }
  }

  console.log("Reset summary:", Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.count ?? 0])));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

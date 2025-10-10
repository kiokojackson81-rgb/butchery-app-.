#!/usr/bin/env -S tsx
// One-off live send script for WhatsApp using the project's transport
// Usage: npx tsx scripts/live-send.ts [to] [template]

const to = process.argv[2] || process.env.TO || "849934581535490";
const template = process.argv[3] || process.env.TEMPLATE || "hello_world";

async function main() {
  try {
    const wa = await import("../src/lib/wa");
    console.log(`Sending template=${template} to=${to}`);
    const res = await wa.sendTemplate({ to, template, params: [], langCode: "en_US" });
    console.log("Result:", JSON.stringify(res, null, 2));
    if ((res as any)?.ok) process.exit(0);
    else process.exit(2);
  } catch (e: any) {
    console.error("Send failed:", e?.message || e);
    process.exit(3);
  }
}

main();

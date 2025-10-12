import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendTemplate } from "@/lib/wa";

// Broadcast the approved template (ops_role_notice) to everyone with a phone mapping
// at 21:00. We dedupe per day/phone via ReminderSend to avoid double-sends.
export async function GET() {
  try {
    // Fetch all mapped phones regardless of role (attendant, supplier, supervisor, admin, etc.)
    const rows = await (prisma as any).phoneMapping.findMany({
      where: { phoneE164: { not: "" } },
      select: { phoneE164: true },
    });
    // Deduplicate by phone
    const seen = new Set<string>();
    const phones: string[] = [];
    for (const r of rows as any[]) {
      const p = String(r.phoneE164 || "").trim();
      if (!p) continue;
      const norm = p.startsWith("+") ? p : "+" + p.replace(/[^0-9+]/g, "");
      if (!seen.has(norm)) { seen.add(norm); phones.push(norm); }
    }

    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const type = "ops-role-notice-21"; // unique type key for 21:00 broadcast

    let sent = 0; let skipped = 0; let errors = 0;
    const params = [
      "Please confirm your role to continue.",
      (process.env.APP_ORIGIN || "https://barakafresh.com") + "/login?src=wa",
    ];

    for (const phone of phones) {
      // Per-day/phone throttling via ReminderSend unique(type, phoneE164, date)
      let canSend = true;
      try {
        await (prisma as any).reminderSend.create({ data: { type, phoneE164: phone, date: dateKey } });
      } catch {
        canSend = false; // duplicate -> already sent today
      }
      if (!canSend) { skipped++; continue; }

      try {
        await sendTemplate({ to: phone, template: "ops_role_notice", params, contextType: "TEMPLATE_REOPEN" });
        sent++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, errors, total: phones.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendTemplate, sendText } from "@/lib/wa";

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
    const type = "ops-reminder-21-30"; // unique type key for 21:30 broadcast

    let sent = 0; let skipped = 0; let errors = 0;

    function roleLabel(r: string): string {
      const k = String(r || '').toLowerCase();
      if (k === 'attendant') return 'Attendant';
      if (k === 'supplier') return 'Supplier';
      if (k === 'supervisor') return 'Supervisor';
      if (k === 'admin') return 'Admin';
      return k ? k[0].toUpperCase() + k.slice(1) : 'User';
    }

    for (const phone of phones) {
      // Per-day/phone throttling via ReminderSend unique(type, phoneE164, date)
      let canSend = true;
      try {
        await (prisma as any).reminderSend.create({ data: { type, phoneE164: phone, date: dateKey } });
      } catch {
        canSend = false; // duplicate -> already sent today
      }
      if (!canSend) { skipped++; continue; }

      // Fetch role for personalized greeting
      let roleName = 'User';
      try {
        const row = await (prisma as any).phoneMapping.findFirst({ where: { phoneE164: phone } });
        roleName = roleLabel(row?.role || '');
      } catch {}

      const text = [
        `🌙 Hello ${roleName},`,
        '',
        `This is a friendly reminder from **Baraka Fresh Butchery Ops** 💼`,
        '',
        `Kindly remember to **log in to your dashboard** this evening to review and update today’s records.`,
        `Please make sure all **sales, stock, deposits, and reports** are submitted before closing time.`,
        '',
        `🔑 Login using your unique code to perform your role as ${roleName}.`,
        '',
        `👉 Login to BarakaOps WhatsApp Dashboard`,
        `https://barakafresh.co.ke/login?src=wa`,
        '',
        `Thank you for keeping operations accurate and consistent every day! 💪`,
        `— Baraka Fresh Team`,
      ].join('\n');

      try {
        // sendText will auto-reopen the window by sending the ops_role_notice template when needed
        await sendText(phone, text, 'AI_DISPATCH_TEXT');
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

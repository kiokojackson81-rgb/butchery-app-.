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
      select: { phoneE164: true, role: true, code: true },
    });
    // Deduplicate by phone
    const seen = new Set<string>();
    const people: Array<{ phone: string; role: string; code?: string | null }> = [];
    for (const r of rows as any[]) {
      const p = String(r.phoneE164 || "").trim();
      if (!p) continue;
      const norm = p.startsWith("+") ? p : "+" + p.replace(/[^0-9+]/g, "");
      if (!seen.has(norm)) { seen.add(norm); people.push({ phone: norm, role: String(r.role || '').toLowerCase(), code: r.code || null }); }
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

    async function lastInboundAt(phoneE164: string): Promise<Date | null> {
      try {
        const sess = await (prisma as any).waSession.findFirst({ where: { phoneE164 } });
        const fromSess = (sess?.updatedAt as Date | undefined) || null;
        const noPlus = phoneE164.replace(/^\+/, "");
        const msg = await (prisma as any).waMessageLog.findFirst({
          where: { direction: "in", payload: { path: ["from"], equals: noPlus } as any },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }).catch(() => null);
        const fromLog = (msg?.createdAt as Date | undefined) || null;
        return (fromLog && fromSess) ? (fromLog > fromSess ? fromLog : fromSess) : (fromLog || fromSess);
      } catch { return null; }
    }

    function minutesSince(date?: Date | string | null): number {
      if (!date) return Infinity;
      const t = typeof date === "string" ? new Date(date).getTime() : (date as Date).getTime();
      return (Date.now() - t) / 60000;
    }

    for (const person of people) {
      const phone = person.phone;
      // Per-day/phone throttling via ReminderSend unique(type, phoneE164, date)
      let canSend = true;
      try {
        await (prisma as any).reminderSend.create({ data: { type, phoneE164: phone, date: dateKey } });
      } catch {
        canSend = false; // duplicate -> already sent today
      }
      if (!canSend) { skipped++; continue; }

      // Personalization: role and optional first name via PersonCode by code
      const roleName = roleLabel(person.role);
      let firstName: string | null = null;
      if (person.code) {
        try {
          const pc = await (prisma as any).personCode.findFirst({ where: { code: person.code } });
          if (pc?.name) firstName = String(pc.name).split(/\s+/)[0];
        } catch {}
      }
      const greetLabel = firstName ? `${firstName} (${roleName})` : roleName;

      // Check inactivity (>24h) to choose message body
      const lastAt = await lastInboundAt(phone);
      const isInactive = minutesSince(lastAt) > 24 * 60;

      let text: string;
      if (isInactive) {
        // Inactivity Reminder (Free Text)
        text = [
          `🌙 Hello ${greetLabel},`,
          '',
          `We noticed you haven’t been active today on **Baraka Fresh Butchery Ops** 💼`,
          '',
          `Kindly remember to **log in to your dashboard** to review or update your daily records.`,
          `This helps keep operations accurate and up to date for everyone.`,
          '',
          `🔑 Please log in using your unique code to continue your role as ${roleName}.`,
          '',
          `💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa`,
          `🌐 Access via Web Dashboard: https://barakafresh.com/`,
          '',
          `Thank you for staying consistent with your updates and teamwork! 💪`,
          `— Baraka Fresh Team`,
        ].join('\n');
      } else {
        // Role-based daily engagement messages
        const links = [
          `💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa`,
          `🌐 Access via Web Dashboard: https://barakafresh.com/`,
        ];
        if (person.role === 'attendant') {
          text = [
            `🌙 Hello ${greetLabel},`,
            '',
            `This is your daily reminder from **Baraka Fresh Butchery Ops** 💼`,
            '',
            `Please remember to **log in to your dashboard** and update all entries for today —`,
            `✅ Sales recorded`,
            `✅ Stock closing count`,
            `✅ Deposits submitted`,
            `✅ Wastage or returns captured`,
            '',
            `🔑 Login using your unique code to continue your work as Attendant.`,
            '',
            ...links,
            '',
            `Thank you for keeping your records accurate every day! 💪`,
            `— Baraka Fresh Team`,
          ].join('\n');
        } else if (person.role === 'supervisor') {
          text = [
            `🌙 Hello ${greetLabel},`,
            '',
            `Friendly reminder from **Baraka Fresh Butchery Ops** 💼`,
            '',
            `Please log in to your dashboard to:`,
            `✅ Review attendants’ submissions`,
            `✅ Approve daily reports and closing stocks`,
            `✅ Verify deposits and expenses`,
            '',
            `🔑 Login using your unique code to manage your supervisor duties.`,
            '',
            ...links,
            '',
            `Thank you for ensuring accuracy and accountability daily! 🙌`,
            `— Baraka Fresh Team`,
          ].join('\n');
        } else if (person.role === 'admin') {
          text = [
            `🌙 Hello ${greetLabel},`,
            '',
            `This is your 9:30 PM system reminder from **Baraka Fresh Butchery Ops** 💼`,
            '',
            `Please log in to your dashboard to:`,
            `✅ Review outlet summaries`,
            `✅ Confirm reports from supervisors`,
            `✅ Monitor deposits and balances`,
            `✅ Update records or resolve pending issues`,
            '',
            `🔑 Login using your admin code to manage system operations.`,
            '',
            ...links,
            '',
            `Thank you for keeping Baraka Fresh running smoothly! ⚙️`,
            `— Baraka Fresh Team`,
          ].join('\n');
        } else if (person.role === 'supplier') {
          text = [
            `🌙 Hello ${greetLabel},`,
            '',
            `A quick reminder from **Baraka Fresh Butchery Ops** 💼`,
            '',
            `Please log in to your supplier dashboard to:`,
            `✅ Review today’s deliveries`,
            `✅ Confirm supplies received by outlets`,
            `✅ Plan tomorrow’s dispatch if needed`,
            '',
            `🔑 Login using your supplier code to stay updated.`,
            '',
            ...links,
            '',
            `Thank you for keeping our supply chain reliable and consistent! 🚛`,
            `— Baraka Fresh Team`,
          ].join('\n');
        } else {
          // Fallback generic message for unknown roles
          text = [
            `🌙 Hello ${greetLabel},`,
            '',
            `This is a friendly reminder from **Baraka Fresh Butchery Ops** 💼`,
            '',
            `Please log in and review your daily records.`,
            '',
            ...links,
            '',
            `Thank you!`,
            `— Baraka Fresh Team`,
          ].join('\n');
        }
      }

      try {
        // sendText will auto-reopen the window by sending the ops_role_notice template when needed
        await sendText(phone, text, 'AI_DISPATCH_TEXT');
        sent++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, errors, total: people.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

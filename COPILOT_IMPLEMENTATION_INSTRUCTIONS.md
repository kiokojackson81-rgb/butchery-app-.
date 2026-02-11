🚀 COPILOT IMPLEMENTATION INSTRUCTIONS
🎯 Objective

Implement WhatsApp template sending using the approved templates:

midnight_payment_summary

high_value_payment_alert

till_balance_response

System must:

Send high-value alert immediately when payment > 500

Reply with balance template when user sends “balance”

Prepare cron endpoint for midnight summary

Use production sending (disable WA_DRY_RUN)

1️⃣ Ensure Template Sender Exists

If not already present, implement:

// src/lib/whatsapp/sendTemplate.ts

export async function sendWhatsAppTemplateMessage({
  to,
  templateName,
  bodyParams
}: {
  to: string;
  templateName: string;
  bodyParams: string[];
}) {
  const token = process.env.WHATSAPP_TOKEN!;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;

  return fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: bodyParams.map(v => ({
              type: "text",
              text: String(v)
            }))
          }
        ]
      }
    })
  });
}

2️⃣ HIGH VALUE PAYMENT ALERT (REAL-TIME)

Trigger inside payment success logic:

if (payment.status === "SUCCESS" && payment.amount > 500) {
  const payerDisplay =
    [payment.firstName, payment.middleName, payment.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    (payment.phone ? `+${payment.phone}` : "") ||
    payment.billRef ||
    "Customer";

  await sendWhatsAppTemplateMessage({
    to: process.env.ADMIN_PHONE!,
    templateName: "high_value_payment_alert",
    bodyParams: [
      payment.outletName,
      payment.amount,
      payerDisplay,
      new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }),
      payment.tillNumber,
      payment.reference,
      payment.newBalance
    ]
  });
}

3️⃣ BALANCE COMMAND HANDLER

Inside WhatsApp webhook:

if (incomingText?.toLowerCase() === "balance") {
  const outlet = await resolveOutletFromPhone(senderPhone);

  const totals = await computeTodayTotals(outlet);

  await sendWhatsAppTemplateMessage({
    to: senderPhone,
    templateName: "till_balance_response",
    bodyParams: [
      outlet.name,
      totals.date,
      totals.total,
      totals.count
    ]
  });
}

4️⃣ MIDNIGHT SUMMARY CRON ENDPOINT

Create:

/api/cron/midnight-payments

Implementation:

export async function GET() {
  const today = getTodayNairobiDate();

  const allOutlets = await computeAllOutletsTotals(today);

  await sendWhatsAppTemplateMessage({
    to: process.env.ADMIN_PHONE!,
    templateName: "midnight_payment_summary",
    bodyParams: [
      "All outlets",
      today,
      allOutlets.count,
      allOutlets.total,
      allOutlets.topPayers
    ]
  });

  return Response.json({ ok: true });
}

5️⃣ ENABLE PRODUCTION MODE

Ensure:

WA_DRY_RUN=false


Remove any:

if (process.env.WA_DRY_RUN === "true") return;

6️⃣ REQUIRED ENV VARIABLES

Ensure these exist in production:

WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
ADMIN_PHONE=2547XXXXXXXX
SUPERVISOR_BARAKA_A=2547XXXXXXXX
KYALO_PHONE=2547XXXXXXXX
APP_TZ=Africa/Nairobi

✅ FINAL CHECKLIST

Templates approved in Meta

Env variables set

Webhook verified

Cron scheduled at 21:00 UTC (midnight Kenya)

WA_DRY_RUN disabled

🔥 AFTER DEPLOYMENT

System will:

Immediately send alert for payment > 500

Reply to “balance”

Send midnight summary daily

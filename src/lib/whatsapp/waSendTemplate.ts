export async function waSendTemplate(args: {
  to: string;
  templateName: string;
  bodyParams: string[];
  langOverride?: string | null;
}) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let lang = args.langOverride || process.env.WA_TEMPLATE_LANG || "en";
  if (String(lang).toLowerCase() === 'en_us' || String(lang).toLowerCase() === 'en-us') lang = 'en';

  if (!token || !phoneId) throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID");

  // IMPORTANT: log once for debugging (remove later)
  console.log("[WA_TEMPLATE_SEND]", { templateName: args.templateName, lang, to: args.to });

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: args.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: args.templateName,
        language: { code: lang },
        components: [
          {
            type: "body",
            parameters: args.bodyParams.map((t) => ({ type: "text", text: String(t) })),
          },
        ],
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error("[WA_TEMPLATE_FAIL]", res.status, data);

  return { ok: res.ok, status: res.status, data };
}

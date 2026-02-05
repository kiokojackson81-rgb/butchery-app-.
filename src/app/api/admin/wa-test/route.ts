import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
	try {
		const env = (name: string) => (process.env[name] ? "set" : "missing");
		const { hasPhoneNumberId, hasToken } = await import('@/lib/whatsapp/config');
		const flags = {
			WA_AI_ENABLED: String(process.env.WA_AI_ENABLED || "true").toLowerCase(),
			WA_AUTOSEND_ENABLED: String(process.env.WA_AUTOSEND_ENABLED || "false").toLowerCase(),
			WA_DRY_RUN: String(process.env.WA_DRY_RUN || "true").toLowerCase(),
		};
		const config = {
			APP_ORIGIN: process.env.APP_ORIGIN || "",
			WHATSAPP_PHONE_NUMBER_ID: hasPhoneNumberId() ? 'set' : 'missing',
			WHATSAPP_TOKEN: hasToken() ? 'set' : 'missing',
			WHATSAPP_VERIFY_TOKEN: env("WHATSAPP_VERIFY_TOKEN"),
			WHATSAPP_APP_SECRET: env("WHATSAPP_APP_SECRET"),
			OPENAI_API_KEY: env("OPENAI_API_KEY"),
		};

		// Optional: ping GPT endpoint to validate routing when enabled
		let gpt: any = { tried: false };
		if (flags.WA_AI_ENABLED === "true" && config.APP_ORIGIN) {
			try {
				gpt.tried = true;
				const resp = await fetch(`${config.APP_ORIGIN}/api/whatsapp/gpt`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					cache: "no-store",
					body: JSON.stringify({ phoneE164: "+254700000000", text: "ping" })
				});
				gpt.status = resp.status;
				const data = await resp.json().catch(() => ({}));
				gpt.ok = !!data?.ok;
			} catch (e: any) {
				gpt.error = e?.message || String(e);
			}
		}

		return NextResponse.json({ ok: true, flags, config, gpt });
	} catch (e: any) {
		return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
	}
}


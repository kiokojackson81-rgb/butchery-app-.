import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public-safe diagnostics: exposes presence/flags only, no secret values.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const doPing = url.searchParams.get("ping") === "1";

  // Restrict access: require a shared key. Accept either header `x-status-key` or query `key`.
  // If STATUS_PUBLIC_KEY is not configured, deny by default.
  const requiredKey = process.env.STATUS_PUBLIC_KEY || "";
  const providedKey = req.headers.get("x-status-key") || url.searchParams.get("key") || "";
  if (!requiredKey || providedKey !== requiredKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        note:
          "Provide the correct key via header x-status-key or query ?key=... (configure STATUS_PUBLIC_KEY).",
      },
      { status: 401 }
    );
  }

  const now = new Date().toISOString();
  const WA_AI_ENABLED = process.env.WA_AI_ENABLED === "true";
  const WA_AUTOSEND_ENABLED = process.env.WA_AUTOSEND_ENABLED === "true";
  const NEXT_PUBLIC_WA_PUBLIC_E164 = process.env.NEXT_PUBLIC_WA_PUBLIC_E164 || null;

  const { hasPhoneNumberId, hasToken, getAppSecret } = await import('@/lib/whatsapp/config');
  const envPresence = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    whatsapp: {
      phoneNumberId: hasPhoneNumberId(),
      token: hasToken(),
      verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecret: Boolean(getAppSecret()),
    },
  };

  let ping: undefined | { ok: boolean; ms: number; model: string; error?: string } = undefined;

  if (doPing) {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const started = Date.now();
    try {
      if (!apiKey) throw new Error("OPENAI_API_KEY missing");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a terse health-check responder." },
            { role: "user", content: "ping" },
          ],
          max_tokens: 4,
          temperature: 0,
        }),
      });
      const ms = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        ping = { ok: false, ms, model, error: `HTTP ${res.status} ${res.statusText} ${text}`.slice(0, 300) };
      } else {
        // We don't return the content to keep it minimal; just success timing.
        ping = { ok: true, ms, model };
      }
    } catch (err: any) {
      const ms = Date.now() - started;
      ping = { ok: false, ms, model: "gpt-4o-mini", error: String(err?.message || err) };
    }
  }

  return NextResponse.json({
    ok: true,
    now,
    flags: { WA_AI_ENABLED, WA_AUTOSEND_ENABLED },
    env: envPresence,
    public: { NEXT_PUBLIC_WA_PUBLIC_E164 },
    ping,
    note:
      "Public-safe status. Secrets are NOT exposed. Access requires STATUS_PUBLIC_KEY via header x-status-key or query ?key=.",
  });
}

// src/app/api/daraja/c2b/register/route.ts
import { NextResponse } from "next/server";

function env(name: string, soft = false) {
  const v = process.env[name];
  if (!v && !soft) throw new Error(`${name} not set`);
  return v || "";
}

async function getAccessToken() {
  const base = env("DARAJA_BASE_URL") || "https://api.safaricom.co.ke";
  const key = env("DARAJA_CONSUMER_KEY");
  const secret = env("DARAJA_CONSUMER_SECRET");
  const cred = Buffer.from(`${key}:${secret}`).toString("base64");

  const r = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${cred}` }, cache: "no-store" }
  );

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Token error ${r.status}: ${text}`);
  }
  const json = JSON.parse(text);
  return json.access_token as string;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "use POST to register",
    base: process.env.PUBLIC_BASE_URL || "",
    shortcode: process.env.DARAJA_C2B_SHORTCODE || "",
  });
}

export async function POST(req: Request) {
  try {
    const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL");

    // Optional admin override: allow specifying a different shortcode (and optionally base/key/secret)
    // Only honored when x-admin-key matches ADMIN_API_KEY. Otherwise, env defaults are used.
    const adminKey = process.env.ADMIN_API_KEY || "";
    const hdrKey = req.headers.get("x-admin-key") || "";
    let bodyJson: any = null;
    try { bodyJson = await req.json(); } catch {}
    const canOverride = Boolean(adminKey) && hdrKey === adminKey;

    const SHORTCODE = (canOverride && bodyJson?.shortcode) ? String(bodyJson.shortcode) : env("DARAJA_C2B_SHORTCODE");
    const base = (canOverride && bodyJson?.base) ? String(bodyJson.base) : (env("DARAJA_BASE_URL") || "https://api.safaricom.co.ke");

    // --- OAuth (explicit fetch so we can log headers/x-request-id) ---
    const tokenRes = await fetch(
      `${process.env.DARAJA_BASE_URL || base}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${(canOverride && bodyJson?.key) ? String(bodyJson.key) : process.env.DARAJA_CONSUMER_KEY}:${(canOverride && bodyJson?.secret) ? String(bodyJson.secret) : process.env.DARAJA_CONSUMER_SECRET}`
            ).toString("base64"),
        },
        cache: "no-store",
      }
    );

    console.log("OAuth status:", tokenRes.status, "x-request-id:", tokenRes.headers.get("x-request-id"));
    let tokenJson: any = null;
    try {
      tokenJson = await tokenRes.json();
    } catch (e) {
      // ignore parse errors
    }
    console.log("OAuth has token?", Boolean(tokenJson?.access_token));

    const body = {
      ShortCode: SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: `${PUBLIC_BASE_URL}/api/daraja/c2b/confirm`,
      ValidationURL: `${PUBLIC_BASE_URL}/api/daraja/c2b/validate`,
    };

    // --- Register ---
    // Prefer v2 endpoint as advised by Safaricom API Support; fall back to v1 if needed
    const doRegister = async (path: string) => {
      const url = `${process.env.DARAJA_BASE_URL || base}${path}`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenJson?.access_token ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      console.log("Register status:", r.status, path, "x-request-id:", r.headers.get("x-request-id"));
      return r;
    };

    let res = await doRegister("/mpesa/c2b/v2/registerurl");
    if (!res.ok) {
      // Try v1 as a fallback
      const fallback = await doRegister("/mpesa/c2b/v1/registerurl");
      // Prefer the successful one if any
      if (fallback.ok) res = fallback; else res = fallback;
    }

    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }

    // Treat "URLs are already registered" as idempotent success to avoid noisy 500s in logs
    const already = typeof data === 'object' && data && (
      String((data as any).errorMessage || '').toLowerCase().includes('already registered') ||
      (data as any).errorCode === '500.003.1001'
    );

    if (!res.ok && already) {
      return NextResponse.json(
        { ok: true, idempotent: true, status: res.status, message: 'URLs are already registered', shortcode: SHORTCODE, data },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: res.ok, status: res.status, data, shortcode: SHORTCODE },
      { status: res.ok ? 200 : 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

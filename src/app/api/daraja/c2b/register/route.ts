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

export async function POST() {
  try {
    const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL");
    const SHORTCODE = env("DARAJA_C2B_SHORTCODE");
  const base = env("DARAJA_BASE_URL") || "https://api.safaricom.co.ke";

    const token = await getAccessToken();

    const body = {
      ShortCode: SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: `${PUBLIC_BASE_URL}/api/daraja/c2b/confirm`,
      ValidationURL: `${PUBLIC_BASE_URL}/api/daraja/c2b/validate`,
    };

  const res = await fetch(`${base}/mpesa/c2b/v1/registerurl`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }

    return NextResponse.json(
      { ok: res.ok, status: res.status, data },
      { status: res.ok ? 200 : 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

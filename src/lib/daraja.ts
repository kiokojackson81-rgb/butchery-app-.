const BASE = process.env.DARAJA_BASE_URL!;
const KEY = process.env.DARAJA_CONSUMER_KEY!;
const SECRET = process.env.DARAJA_CONSUMER_SECRET!;

export async function getAccessToken() {
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("OAuth failed");
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function darajaPost(path: string, token: string, body: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export function yyyymmddhhmmss(d = new Date()) {
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

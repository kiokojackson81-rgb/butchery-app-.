import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = { email?: string; password?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const email = String(body.email || '').trim().toLowerCase();
    const pw = String(body.password || '');

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'kiokojackson81@gmail.com';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ads0k015@#';

    if (email !== ADMIN_EMAIL || pw !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
    }

    // Use ADMIN_API_TOKEN as the server-side session value when present, otherwise a dev token
    const token = process.env.ADMIN_API_TOKEN || 'dev-admin-token';
    const res = NextResponse.json({ ok: true });
    res.cookies.set('admin_token', token, { httpOnly: true, path: '/', sameSite: 'lax' });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

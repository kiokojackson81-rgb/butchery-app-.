import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";
import { toE164DB, toGraphPhone } from "@/server/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      error: "unauthorized",
      note: "Provide STATUS_PUBLIC_KEY via header x-status-key or query ?key=",
    },
    { status: 401 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const providedKey = req.headers.get("x-status-key") || url.searchParams.get("key") || "";
  const requiredKey = process.env.STATUS_PUBLIC_KEY || "";
  if (!requiredKey || providedKey !== requiredKey) return unauthorized();

  const rawPhone = url.searchParams.get("phone") || "";
  const rawCode = url.searchParams.get("code") || "";
  if (!rawPhone && !rawCode) return NextResponse.json({ ok: false, error: "missing phone or code" }, { status: 400 });

  let phoneE164: string | null = null;
  let mapping: any = null;

  try {
    if (rawCode) {
      const code = canonFull(rawCode);
      mapping = await (prisma as any).phoneMapping.findUnique({ where: { code } }).catch(() => null);
      phoneE164 = mapping?.phoneE164 || null;
    }
  } catch {}

  if (!phoneE164 && rawPhone) {
    try { phoneE164 = toE164DB(rawPhone); } catch { phoneE164 = null; }
  }

  if (!phoneE164) return NextResponse.json({ ok: false, error: "unable to resolve phone" }, { status: 404 });

  // Fetch session and mapping by phone
  const [session, mappingByPhone] = await Promise.all([
    (prisma as any).waSession.findUnique({ where: { phoneE164 } }).catch(() => null),
    mapping ? Promise.resolve(mapping) : (prisma as any).phoneMapping.findFirst({ where: { phoneE164 } }).catch(() => null),
  ]);

  const graph = toGraphPhone(phoneE164);

  // Fetch recent logs related to this phone
  let recentLogs: any[] = [];
  try {
    recentLogs = await (prisma as any).waMessageLog.findMany({
      where: {
        OR: [
          { payload: { path: ["meta", "phoneE164"], equals: phoneE164 } as any },
          { payload: { path: ["phone"], equals: phoneE164 } as any },
          { payload: { path: ["from"], equals: graph } as any },
          { payload: { path: ["to"], equals: graph } as any },
        ] as any,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, direction: true, status: true, type: true, templateName: true, payload: true },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    phoneE164,
    session,
    mapping: mappingByPhone,
    recentLogs,
  });
}

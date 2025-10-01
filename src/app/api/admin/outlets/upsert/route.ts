import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/codeNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const { outlets } = (await req.json().catch(() => ({}))) as { outlets?: Array<{ name?: string; code?: string; active?: boolean }> };
    if (!Array.isArray(outlets)) {
      return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    for (const o of outlets) {
      if (!o?.name) continue;
      const normCode = normalizeCode(o.code || o.name);
      // Upsert by unique name (schema constraint); set/update code to normalized form
      await (prisma as any).outlet.upsert({
        where: { name: o.name },
        update: { code: normCode, name: o.name, active: !!o.active },
        create: { name: o.name, code: normCode, active: !!o.active },
      });
    }

    await (prisma as any).setting.upsert({
      where: { key: "admin_outlets" },
      update: { value: outlets },
      create: { key: "admin_outlets", value: outlets },
    });

    return Response.json({ ok: true, count: outlets.length });
  } catch (e: any) {
    console.error(e);
    return Response.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

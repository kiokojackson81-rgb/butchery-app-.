import { prisma } from "@/lib/prisma";

export async function logMessage(entry: {
  attendantId?: string | null;
  direction?: "in" | "out";
  templateName?: string | null;
  payload: any;
  waMessageId?: string | null;
  status?: string | null;
  type?: string | null; // soft type; stored in payload.meta._type when column absent
  createdAt?: Date;
}) {
  // Hotflag: allow disabling DB logging immediately in prod incidents
  const disableRaw = (() => {
    const v = process.env.WA_DISABLE_RAW_LOG?.toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  })();

  if (disableRaw) {
    // Intentionally no-op to avoid any raw logging paths under incident response
    return;
  }

  try {
    // Centralize via Prisma client (which is already hardened/extended in prisma.ts)
    const data = {
      attendantId: entry.attendantId ?? null,
      direction: entry.direction ?? "out",
      templateName: entry.templateName ?? null,
      payload: entry.payload ?? {},
      waMessageId: entry.waMessageId ?? null,
      status: entry.status ?? null,
      type: entry.type ?? null,
      createdAt: entry.createdAt ?? new Date(),
    } as any;

    await (prisma as any).waMessageLog.create({ data });
  } catch {
    // Swallow logging errors; never block main flows
  }
}

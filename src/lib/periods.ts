import { prisma } from "./prisma";

// Minimal helper to fetch the active trading period for an outlet.
export async function getActivePeriodForOutlet(outlet: string) {
  try {
    const row = await (prisma as any).activePeriod.findFirst({ where: { outlet } }).catch(() => null);
    if (!row) return null;
    return { id: row.id, date: row.date };
  } catch {
    return null;
  }
}

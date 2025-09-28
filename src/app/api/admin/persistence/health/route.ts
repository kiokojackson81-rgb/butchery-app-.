import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const p: any = prisma as any;
    const [
      outlets,
      attendants,
      assignments,
      appState,
      sessions,
      settings,
      products,
      pricebookRows,
      supplyOpenings,
      transfers,
      closings,
      deposits,
      expenses,
      activePeriods,
      phoneMappings,
      personCodes,
      chatraceSettings,
      supplyRequests,
      reviewItems,
    ] = await Promise.all([
      p.outlet?.count?.() ?? 0,
      p.attendant?.count?.() ?? 0,
      p.attendantAssignment?.count?.() ?? 0,
      p.appState?.count?.() ?? 0,
      p.session?.count?.() ?? 0,
      p.setting?.count?.() ?? 0,
      p.product?.count?.() ?? 0,
      p.pricebookRow?.count?.() ?? 0,
      p.supplyOpeningRow?.count?.() ?? 0,
      p.supplyTransfer?.count?.() ?? 0,
      p.attendantClosing?.count?.() ?? 0,
      p.attendantDeposit?.count?.() ?? 0,
      p.attendantExpense?.count?.() ?? 0,
      p.activePeriod?.count?.() ?? 0,
      p.phoneMapping?.count?.() ?? 0,
      p.personCode?.count?.() ?? 0,
      p.chatraceSetting?.count?.() ?? 0,
      p.supplyRequest?.count?.() ?? 0,
      p.reviewItem?.count?.() ?? 0,
    ]);
    return NextResponse.json({
      outlets,
      attendants,
      assignments,
      appState,
      sessions,
      settings, // raw settings rows
      adminSettings: settings, // alias
      products,
      pricebookRows,
      supplyOpenings,
      transfers,
      closings,
      deposits,
      expenses,
      activePeriods,
      phoneMappings,
      personCodes,
      chatraceSettings,
      supplyRequests,
      reviewItems,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

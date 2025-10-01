import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import { prisma } from "@/lib/prisma";
import { sendSupplyReceived } from "@/lib/wa";

export async function POST(req: Request) {
	try {
		const { date, outlet } = (await req.json().catch(() => ({}))) as {
			date?: string;
			outlet?: string;
		};
		if (!date || !outlet) return NextResponse.json({ ok: false, error: "date/outlet required" }, { status: 400 });

		// In a real lock, you'd persist a flag; for now, treat as finalize + notify.
		const rows = await (prisma as any).supplyOpeningRow.findMany({ where: { date, outletName: outlet } });

		// Resolve attendants for outlet from phone mappings, and try to get their names via Attendant.loginCode
		const maps = await (prisma as any).phoneMapping.findMany({ where: { role: "attendant", outlet } });

		// Build a quick lookup from code -> attendant name
		const codes = maps.map((m: any) => m.code).filter(Boolean);
		const attendants = codes.length
			? await (prisma as any).attendant.findMany({ where: { loginCode: { in: codes } } })
			: [];
		const nameByCode = new Map<string, string>();
		for (const a of attendants) {
			if (a?.loginCode) nameByCode.set(a.loginCode, a.name || a.loginCode);
		}

		// Notify each attendant per item (could be summarized if needed)
		const notifications: Promise<any>[] = [];
		for (const m of maps) {
			const phone = (m.phoneE164 as string) || "";
			const attName = (m.code && nameByCode.get(m.code)) || m.code || "Attendant";
			for (const r of rows) {
				notifications.push(
					sendSupplyReceived(phone, attName, String(r.itemKey), Number(r.qty))
				);
			}
		}
		await Promise.allSettled(notifications);

		return NextResponse.json({ ok: true, notified: maps.length, items: rows.length });
	} catch (e: any) {
		return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
	}
}

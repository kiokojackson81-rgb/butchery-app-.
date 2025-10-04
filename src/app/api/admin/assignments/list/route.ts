import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ScopeMap = Record<string, { outlet: string; productKeys: string[] }>;

// Local normalization to align with tests: lowercase, trim, remove spaces
function canon(input: string): string {
	return String(input || "").trim().toLowerCase().replace(/\s+/g, "");
}

export async function GET() {
	try {
		// Prefer the normalized scope table (AttendantScope + ScopeProduct)
		const scopes = await (prisma as any).attendantScope.findMany({
			include: { products: true },
		});
		const map: ScopeMap = {};
		for (const s of scopes as any[]) {
			const code = String(s?.codeNorm || "");
			if (!code) continue;
			const outlet = String(s?.outletName || "");
			const keys = Array.isArray(s?.products)
				? (s.products as any[])
						.map((p) => String(p?.productKey || "").trim())
						.filter((k) => k.length > 0)
						.sort()
				: [];
			map[code] = { outlet, productKeys: keys };
		}

		// Fill any missing via the legacy AttendantAssignment table
		const assigns = await (prisma as any).attendantAssignment.findMany({});
		for (const a of assigns as any[]) {
			const key = canon(String(a?.code || ""));
			if (!key || map[key]) continue;
			const outlet = String(a?.outlet || "");
			const rawKeys = Array.isArray(a?.productKeys) ? (a.productKeys as any[]) : [];
			const keys = rawKeys
				.map((k) => String(k || "").trim())
				.filter((k) => k.length > 0)
				.sort();
			map[key] = { outlet, productKeys: keys };
		}

		// Final fallback: mirror from Settings admin_codes for attendants
		try {
			const settingsRow = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
			const list: any[] = Array.isArray((settingsRow as any)?.value) ? (settingsRow as any).value : [];
			const attendants = list.filter((p: any) => !!p?.active && String(p?.role || "").toLowerCase() === "attendant");
			for (const p of attendants) {
				const key = canon(String(p?.code || ""));
				const outlet = String(p?.outlet || "");
				if (!key || !outlet || map[key]) continue;
				map[key] = { outlet, productKeys: [] };
			}
		} catch {}

		return NextResponse.json({ ok: true, scope: map });
	} catch (e: any) {
		console.error("assignments.list error", e);
		return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
	}
}


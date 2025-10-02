import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ScopeMap = Record<string, { outlet: string; productKeys: string[] }>;

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
			const code = String(a?.code || "");
			if (!code || map[code]) continue;
			const outlet = String(a?.outlet || "");
			const rawKeys = Array.isArray(a?.productKeys) ? (a.productKeys as any[]) : [];
			const keys = rawKeys
				.map((k) => String(k || "").trim())
				.filter((k) => k.length > 0)
				.sort();
			map[code] = { outlet, productKeys: keys };
		}

		return NextResponse.json({ ok: true, scope: map });
	} catch (e: any) {
		console.error("assignments.list error", e);
		return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
	}
}


import { NextResponse, type NextRequest } from "next/server";
import { normalizeToPlusE164 } from "@/lib/wa_phone";

export function middleware(req: NextRequest) {
  const { nextUrl } = req;
  if (nextUrl.pathname === "/login") {
    const waRaw = nextUrl.searchParams.get("wa");
    if (waRaw) {
      const plus = normalizeToPlusE164(waRaw);
      const valid = /^\+\d{10,15}$/.test(plus);
      if (valid) {
        const graph = plus.replace(/^\+/, "");
        const res = NextResponse.next();
        res.cookies.set("wa_click_phone", plus, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
        res.cookies.set("wa_click_graph", graph, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
        return res;
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/login"],
};

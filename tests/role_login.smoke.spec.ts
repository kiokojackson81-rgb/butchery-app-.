import { expect, test } from "vitest";

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function put(path: string, body?: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = r.headers.get("set-cookie") || undefined;
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, cookie: setCookie } as const;
}

async function get(path: string, cookie?: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
    },
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json } as const;
}

test("role login (supervisor) → me", async () => {
  const CODE = process.env.SMOKE_SUPERVISOR_CODE;
  if (!CODE) return; // env not provided, soft-skip

  const login = await put("/api/auth/login", { code: CODE });
  expect(login.status).toBeLessThan(500);
  if (!login.json?.ok) return; // not configured in admin_codes, soft-skip
  expect(login.json.role).toBe("supervisor");
  const cookie = login.cookie || "";
  expect(cookie).toContain("bk_role=");

  const me = await get("/api/auth/me", cookie);
  expect(me.status).toBe(200);
  expect(me.json?.ok).toBe(true);
  expect(me.json?.role).toBe("supervisor");
});

test("role login (supplier) → me", async () => {
  const CODE = process.env.SMOKE_SUPPLIER_CODE;
  if (!CODE) return; // env not provided, soft-skip

  const login = await put("/api/auth/login", { code: CODE });
  expect(login.status).toBeLessThan(500);
  if (!login.json?.ok) return; // not configured in admin_codes, soft-skip
  expect(["supplier", "supervisor"]).toContain(login.json.role);
  const cookie = login.cookie || "";
  expect(cookie).toContain("bk_role=");

  const me = await get("/api/auth/me", cookie);
  expect(me.status).toBe(200);
  expect(me.json?.ok).toBe(true);
  expect(["supplier", "supervisor"]).toContain(me.json?.role);
});

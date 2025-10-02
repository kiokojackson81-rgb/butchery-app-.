import { expect, test } from "vitest";

const BASE = (() => {
  const b = process.env.BASE_URL || "http://localhost:3000";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "http://localhost:3000";
})();

async function post(path: string, body?: any, cookie?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
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

test("attendant login → products → expense/deposit/closing → txns", async () => {
  const LOGIN_CODE = process.env.SMOKE_ATTENDANT_CODE || "BR1234"; // falls back to sample

  // Login
  const login = await post("/api/auth/login", { loginCode: LOGIN_CODE });
  expect(login.status).toBeLessThan(500);
  expect(login.json).toHaveProperty("ok");
  if (!login.json.ok) return; // skip rest if invalid code in env
  const cookie = login.cookie || "";
  expect(cookie).toContain("bk_sess=");

  // Me
  const me = await get("/api/auth/me", cookie);
  expect(me.status).toBe(200);
  expect(me.json?.ok).toBe(true);

  // Products
  const products = await get("/api/attendant/products", cookie);
  expect(products.status).toBe(200);
  expect(products.json?.ok).toBe(true);

  // Expense add (no-op ok)
  const exp = await post("/api/attendant/expense/add", { items: [{ name: "Water", amount: 50 }] }, cookie);
  expect(exp.status).toBeLessThan(500);

  // Deposit submit (no-op ok)
  const dep = await post(
    "/api/attendant/deposit/submit",
    { entries: [{ code: "M-PESA", amount: 1000, note: "float" }] },
    cookie
  );
  expect(dep.status).toBeLessThan(500);

  // Closing save (empty set OK)
  const closing = await post(
    "/api/attendant/closing/save",
    { closingMap: {}, wasteMap: {} },
    cookie
  );
  expect(closing.status).toBeLessThan(500);

  // Txns
  const txns = await get("/api/attendant/txns", cookie);
  expect(txns.status).toBe(200);
  expect(txns.json?.ok).toBe(true);
});

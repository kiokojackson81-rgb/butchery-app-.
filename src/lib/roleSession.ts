import { cookies } from "next/headers";
import crypto from "crypto";

const ROLE_COOKIE = "bk_role";
// Short TTL with sliding renewal handled in getRoleSession
const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes

type Role = "attendant" | "supervisor" | "supplier";
export type RolePayload = {
  role: Role;
  code: string;
  outlet?: string | null;
  exp: number; // epoch seconds
};

function getSecret() {
  return process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "dev-secret";
}

function hmac(input: string): string {
  return crypto.createHmac("sha256", getSecret()).update(input).digest("hex");
}

export function encodeRoleToken(payload: Omit<RolePayload, "exp"> & { exp?: number }): string {
  const exp = payload.exp || Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
  const body = { ...payload, exp } as RolePayload;
  const json = JSON.stringify(body);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const mac = hmac(b64);
  return `v1.${b64}.${mac}`;
}

export function decodeRoleToken(token?: string | null): RolePayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [_, b64, mac] = parts;
  if (hmac(b64) !== mac) return null;
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const data = JSON.parse(json) as RolePayload;
    if (!data?.role || !data?.code || !data?.exp) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getRoleSession(): Promise<RolePayload | null> {
  const jar = await cookies();
  const token = jar.get(ROLE_COOKIE)?.value;
  const payload = decodeRoleToken(token || null);
  if (!payload) return null;
  // Sliding renewal: if less than half TTL remains, extend
  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;
  if (remaining < Math.floor(DEFAULT_TTL_SECONDS / 2)) {
    const freshExp = now + DEFAULT_TTL_SECONDS;
    const freshToken = encodeRoleToken({ role: payload.role, code: payload.code, outlet: payload.outlet ?? null, exp: freshExp });
    const secure = process.env.NODE_ENV === "production";
    jar.set({
      name: ROLE_COOKIE,
      value: freshToken,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: DEFAULT_TTL_SECONDS,
    } as any);
    return { ...payload, exp: freshExp };
  }
  return payload;
}

export function serializeRoleCookie(payload: Omit<RolePayload, "exp"> & { expSeconds?: number }) {
  const exp = Math.floor(Date.now() / 1000) + (payload.expSeconds || DEFAULT_TTL_SECONDS);
  const token = encodeRoleToken({ role: payload.role, code: payload.code, outlet: payload.outlet ?? null, exp });
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${ROLE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${payload.expSeconds || DEFAULT_TTL_SECONDS}`,
  ];
  return parts.join("; ");
}

export function serializeClearRoleCookie() {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${ROLE_COOKIE}=; Path=/`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    "Max-Age=0",
  ];
  return parts.join("; ");
}

"use client";
// Small client-side helper to centralize localStorage keys and cross-tab sync
export const AuthKeys = {
  admin: "admin_auth",
  attendant: "attendant_code",
} as const;

function broadcastAuth() {
  try {
    const bc = new BroadcastChannel("auth");
    bc.postMessage({ type: "AUTH_SYNC" });
    bc.close();
  } catch {}
}

export function setAdminAuth(payload: { issuedAt?: number; welcome?: string } | string) {
  const toStore = typeof payload === "string" ? { issuedAt: Date.now(), welcome: payload } : payload;
  // Persist to localStorage for cross-tab and sessionStorage for same-tab legacy checks.
  try { localStorage.setItem(AuthKeys.admin, JSON.stringify(toStore)); } catch {}
  try { localStorage.setItem("admin_welcome", (toStore as any).welcome || ""); } catch {}
  try { sessionStorage.setItem("admin_auth", "true"); } catch {}
  try { sessionStorage.setItem("admin_welcome", (toStore as any).welcome || ""); } catch {}
  broadcastAuth();
}
export function clearAdminAuth() {
  try { localStorage.removeItem(AuthKeys.admin); } catch {}
  try { localStorage.removeItem("admin_welcome"); } catch {}
  try { sessionStorage.removeItem("admin_auth"); } catch {}
  try { sessionStorage.removeItem("admin_welcome"); } catch {}
  broadcastAuth();
}
export function getAdminAuth(): { issuedAt?: number; welcome?: string } | null {
  try {
    const raw = localStorage.getItem(AuthKeys.admin);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function getAdminWelcome(): string | null {
  try { return localStorage.getItem("admin_welcome") || null; } catch { return null; }
}

export function setAttendantCode(code: string) {
  try { localStorage.setItem(AuthKeys.attendant, code); } catch {}
  broadcastAuth();
}
export function clearAttendantCode() {
  try { localStorage.removeItem(AuthKeys.attendant); } catch {}
  broadcastAuth();
}
export function getAttendantCode(): string | null {
  try { return localStorage.getItem(AuthKeys.attendant); } catch { return null; }
}

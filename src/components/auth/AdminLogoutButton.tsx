"use client";
import { useRouter } from "next/navigation";

export default function AdminLogoutButton() {
  const router = useRouter();

  async function adminSafeLogout() {
    // Only admin flags (local-first)
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_welcome");
    // Also clear server-side admin session
    try {
      await fetch('/api/admin/session', { method: 'DELETE' });
    } catch (err) {
      try {
        // Fallback: clear legacy AppState flags
        await fetch("/api/state/bulk-set", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ key: "admin_auth", value: null }, { key: "admin_welcome", value: null }] }),
        });
      } catch {}
      console.warn("Failed to clear admin session on server:", err);
    }

    // If you added cookie-based admin middleware, also clear cookie via API:
    // await fetch("/api/admin/session", { method: "DELETE" });

    // DO NOT touch:
    // - sessionStorage: attendant_code
    // - localStorage : attendant_scope, admin_outlets, daily keys
    router.replace("/admin/login");
  }

  return (
    <button className="border rounded px-3 py-1" onClick={adminSafeLogout}>
      Logout
    </button>
  );
}

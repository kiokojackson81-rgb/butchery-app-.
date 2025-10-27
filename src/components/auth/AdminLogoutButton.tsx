"use client";
import { useRouter } from "next/navigation";

export default function AdminLogoutButton() {
  const router = useRouter();

  async function adminSafeLogout() {
    // Only admin flags (local-first)
    sessionStorage.removeItem("admin_auth");
    sessionStorage.removeItem("admin_welcome");
    // Also attempt to clear server-backed AppState so other tabs hydrate logout
    try {
      await fetch("/api/state/bulk-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ key: "admin_auth", value: null }, { key: "admin_welcome", value: null }] }),
      });
    } catch (err) {
      // swallow — user will still be logged out in this tab
      console.warn("Failed to clear admin_auth from AppState:", err);
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

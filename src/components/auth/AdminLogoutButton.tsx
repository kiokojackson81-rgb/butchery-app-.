"use client";
import { useRouter } from "next/navigation";

export default function AdminLogoutButton() {
  const router = useRouter();

  async function adminSafeLogout() {
    // Only admin flags
    sessionStorage.removeItem("admin_auth");
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

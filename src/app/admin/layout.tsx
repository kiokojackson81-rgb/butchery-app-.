"use client";

import { usePathname } from "next/navigation";
import AdminGuard from "@/components/guards/AdminGuard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/admin/login";

  // Never guard the login page
  if (isLogin) return <>{children}</>;

  // Guard everything else under /admin
  return <AdminGuard>{children}</AdminGuard>;
}

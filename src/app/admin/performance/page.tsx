"use client";

import AdminGuard from "@/components/guards/AdminGuard";
import PerformancePage from "@/app/supervisor/performance/page";

export default function AdminPerformancePage() {
  return (
    <AdminGuard>
      <PerformancePage />
    </AdminGuard>
  );
}

"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redirect this standalone admin route to the Admin page with embedded Ops->History
export default function AdminSupplyHistoryPage() {
  const router = useRouter();
  useEffect(() => {
    try {
      // replace so the back button doesn't keep the redirect page in history
      router.replace('/admin?tab=ops&opsTab=history');
    } catch (e) {
      // fallback to full navigation
      window.location.href = '/admin?tab=ops&opsTab=history';
    }
  }, [router]);
  return null;
}

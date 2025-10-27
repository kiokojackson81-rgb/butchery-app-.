"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Prefer server-side session check
        const r = await fetch('/api/admin/session', { cache: 'no-store' });
        if (r.ok) {
          setReady(true);
          return;
        }
      } catch {}
      // Fallback to legacy client-only flag
      const ok = sessionStorage.getItem("admin_auth") === "true";
      if (!ok) {
        router.replace("/admin/login");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  if (!ready) return null; // avoid flicker/loops
  return <>{children}</>;
}

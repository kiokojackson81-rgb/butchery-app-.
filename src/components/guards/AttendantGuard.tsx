"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AttendantGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/me", { cache: "no-store" });
        if (r.ok) {
          if (!cancelled) setReady(true);
          return;
        }
      } catch {}
      if (!cancelled) router.replace("/attendant");
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}

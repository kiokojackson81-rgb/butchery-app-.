"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AttendantGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const code = sessionStorage.getItem("attendant_code");
    if (!code) { router.replace("/attendant"); return; }
    setReady(true);
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}

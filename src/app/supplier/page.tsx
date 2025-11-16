// Deprecated supplier login page. Redirect to dashboard; login flows are WA link-only.
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SupplierLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/supplier/dashboard");
  }, [router]);
  return null;
}

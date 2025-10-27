"use client";
import { useEffect } from "react";
import { getAdminAuth, getAttendantCode } from "@/lib/auth/clientState";

export default function ClientAuthBootstrap() {
  useEffect(() => {
    let reloadTimer: any = null;
    const requestReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => location.reload(), 120);
    };

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "admin_auth" || e.key === "attendant_code" || e.key === "admin_welcome") {
        requestReload();
      }
    };
    window.addEventListener("storage", onStorage);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("auth");
        bc.onmessage = (ev) => {
          if (ev?.data?.type === "AUTH_SYNC") requestReload();
        };
      }
    } catch {}

    // Dev-time warning for mixed-origin usage
    try {
      if (process.env.NODE_ENV === "development" && location.hostname !== "localhost") {
        // eslint-disable-next-line no-console
        console.warn("Dev: prefer http://localhost in all tabs to avoid storage/cookie isolation");
      }
    } catch {}

    return () => {
      window.removeEventListener("storage", onStorage);
      if (bc) bc.close();
      clearTimeout(reloadTimer);
    };
  }, []);

  return null;
}

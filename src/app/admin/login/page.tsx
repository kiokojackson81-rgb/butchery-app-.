"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Credentials are validated on the server. The server route will compare against
// environment variables ADMIN_EMAIL and ADMIN_PASSWORD. This client file no
// longer contains truthy credential constants.

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  // If already authed, skip the form
  useEffect(() => {
    if (sessionStorage.getItem("admin_auth") === "true") {
      router.replace("/admin");
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Call the server-side login endpoint which validates credentials and
    // creates the server-backed session (HTTP-only cookie). On success we
    // set the client sessionStorage for immediate UX in this tab and
    // navigate to /admin. Errors come from the server.
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password: pw }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Invalid email or password.");
        return;
      }

      // Success: set client flag for current tab and navigate. The server has
      // already set the HTTP-only cookie so other tabs will see the session.
      try {
        const { setAdminAuth } = await import("@/lib/auth/clientState");
        setAdminAuth({ issuedAt: Date.now(), welcome: "Welcome boss 👑 — systems are green and ready!" });
      } catch {
        // fallback to sessionStorage if helper unavailable
        try {
          sessionStorage.setItem("admin_auth", "true");
          sessionStorage.setItem("admin_welcome", "Welcome boss 👑 — systems are green and ready!");
          // Mirror to localStorage so other tabs (supplier dashboard) can detect via 'storage' event.
          localStorage.setItem("admin_auth", "true");
          localStorage.setItem("admin_welcome", "Welcome boss 👑 — systems are green and ready!");
        } catch {}
      }
      router.replace("/admin");
    } catch (err: any) {
      setError(String(err?.message ?? err));
    }
  };

  return (
    <main className="mobile-container min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold">Admin Login</h1>
          <p className="text-sm text-gray-600 mt-1">
            Sign in to access the control room.
          </p>
        </header>

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              className="input-mobile border rounded-xl p-2 w-full"
              type="email"
              placeholder="Enter admin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Password</label>
            <div className="flex gap-2">
              <input
                className="input-mobile border rounded-xl p-2 w-full"
                type={showPw ? "text" : "password"}
                placeholder="Enter password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="btn-mobile border rounded-xl px-3"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" className="btn-mobile w-full rounded-xl bg-black text-white py-2">
            Sign in
          </button>
        </form>

        <footer className="mt-5 text-xs text-gray-600">
          This login only protects the <code>/admin</code> section. Attendant/Supervisor areas are unaffected.
        </footer>
      </div>
    </main>
  );
}

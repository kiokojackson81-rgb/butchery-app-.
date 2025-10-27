"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_EMAIL = "kiokojackson81@gmail.com";
const ADMIN_PASSWORD = "Ads0k015@#"; // no spaces

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

    const okEmail = email.trim().toLowerCase() === ADMIN_EMAIL;
    const okPw = pw === ADMIN_PASSWORD;

    if (!okEmail || !okPw) {
      setError("Invalid email or password.");
      return;
    }

    // Set client sessionStorage immediately for this tab
    sessionStorage.setItem("admin_auth", "true");
    sessionStorage.setItem("admin_welcome", "Welcome boss 👑 — systems are green and ready!");

    // Also persist to the server-backed AppState so other tabs can hydrate
    // Do not block navigation on failure, but attempt to save.
    try {
      await fetch("/api/state/bulk-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ key: "admin_auth", value: "true" }, { key: "admin_welcome", value: "Welcome boss 👑 — systems are green and ready!" }] }),
      });
    } catch (err) {
      // swallow - we already set sessionStorage for this tab
      console.warn("Failed to persist admin_auth to server:", err);
    }

    router.replace("/admin");
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

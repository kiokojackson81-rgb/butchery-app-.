// src/app/admin/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_EMAIL = "kiokojackson81@gmail.com";
const ADMIN_PASSWORD = "Ads0k015";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // simple, local check (no network, no side-effects elsewhere)
    if (email.trim().toLowerCase() === ADMIN_EMAIL && pw === ADMIN_PASSWORD) {
      // Mark a lightweight session flag for optional checks
      sessionStorage.setItem("admin_auth", "true");
      sessionStorage.setItem("admin_welcome", "Welcome boss 👑 — let’s make today legendary!");
      // A tiny friendly delay so users see the message
      alert("Welcome boss 👑 — systems are green and ready!");
      router.replace("/admin");
      return;
    }

    setError("Invalid email or password. Please try again, boss.");
  };

  return (
    <main className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold">Admin Login</h1>
          <p className="text-sm text-gray-600 mt-1">
            Welcome boss! 🔐 Sign in to access the control room.
          </p>
        </header>

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              className="border rounded-xl p-2 w-full"
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
                className="border rounded-xl p-2 w-full"
                type={showPw ? "text" : "password"}
                placeholder="Enter password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="border rounded-xl px-3"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-xl bg-black text-white py-2"
          >
            Sign in
          </button>
        </form>

        <footer className="mt-5 text-xs text-gray-600">
          Tip: You can add a tiny check in your admin dashboard to read{" "}
          <code>sessionStorage.admin_auth</code> and bounce back to{" "}
          <code>/admin/login</code> if it’s not set — no other pages are touched.
        </footer>
      </div>
    </main>
  );
}

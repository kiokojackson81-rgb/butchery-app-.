// src/app/supervisor/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SupervisorLoginPage() {
  const [code, setCode] = useState("");
  const router = useRouter();

  const handleLogin = () => {
    if (!code.trim()) {
      alert("Please enter your supervisor code.");
      return;
    }
    // Save supervisor code
    sessionStorage.setItem("supervisor_code", code.trim());
    // Redirect to supervisor dashboard
    router.push("/supervisor/dashboard");
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Supervisor Login</h1>
      <p className="text-sm text-gray-600 mb-6">
        Enter the login code provided by Admin for supervisor access.
      </p>

      <input
        type="text"
        className="border rounded-xl w-full p-3 mb-4"
        placeholder="Enter supervisor code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />

      <button
        onClick={handleLogin}
        className="w-full px-4 py-2 rounded-xl bg-black text-white"
      >
        Login
      </button>
    </main>
  );
}

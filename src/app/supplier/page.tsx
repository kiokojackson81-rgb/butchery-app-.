// src/app/supplier/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SupplierLoginPage() {
  const [code, setCode] = useState("");
  const router = useRouter();

  const handleLogin = () => {
    if (!code.trim()) {
      alert("Please enter your supplier code.");
      return;
    }
    // Save supplier code
    sessionStorage.setItem("supplier_code", code.trim());
    // Redirect to supplier dashboard
    router.push("/supplier/dashboard");
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Supplier Login</h1>
      <p className="text-sm text-gray-600 mb-6">
        Enter the login code provided by Admin for supplier access.
      </p>

      <input
        type="text"
        className="border rounded-xl w-full p-3 mb-4"
        placeholder="Enter supplier code"
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

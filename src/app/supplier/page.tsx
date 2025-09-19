"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/** Primary storage key used by Admin Staff page */
const ADMIN_STAFF_KEY = "admin_staff";

type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";

type Staff = {
  id: string;
  name: string;
  code: string;
  role: "attendant" | "supplier" | "supervisor";
  outlet?: Outlet;
  active: boolean;
};

/** Helpers */
function norm(s: string): string {
  // normalize: trim, collapse inner spaces, lowercase
  return s.replace(/\s+/g, "").trim().toLowerCase();
}

function loadStaff(): Staff[] {
  try {
    // Try known keys (in case your Admin page used a newer key later)
    const candidates = [ADMIN_STAFF_KEY, "admin_staff_v2", "ADMIN_STAFF"];
    for (const key of candidates) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const list = JSON.parse(raw) as Staff[];
        if (Array.isArray(list)) return list;
      }
    }
  } catch {}
  return [];
}

export default function SupplierLoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    setError("");
    const staffList = loadStaff();
    if (staffList.length === 0) {
      setError("No staff configured by Admin (admin_staff is empty).");
      return;
    }

    const input = norm(code);
    const found = staffList.find(
      (s) =>
        s.role === "supplier" &&
        s.active === true &&
        norm(s.code) === input
    );

    if (!found) {
      setError("Invalid supplier code.");
      return;
    }

    // Store session
    sessionStorage.setItem("supplier_code", found.code);
    sessionStorage.setItem("supplier_name", found.name || "Supplier");
    if (found.outlet) {
      sessionStorage.setItem("supplier_outlet", found.outlet);
    }

    router.push("/supplier/dashboard");
  };

  const showKnownCodes = () => {
    const list = loadStaff()
      .filter((s) => s.role === "supplier")
      .map((s) => `${s.name || "Unnamed"} — ${s.code}${s.active ? "" : " (inactive)"}`);
    if (list.length === 0) {
      alert("No supplier codes found in localStorage under 'admin_staff'.");
    } else {
      alert("Supplier codes found:\n\n" + list.join("\n"));
    }
  };

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Supplier Login</h1>

      <input
        className="border rounded-xl p-2 w-full mb-3"
        placeholder="Enter supplier code (e.g. SUPP001)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />

      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleLogin}
          className="px-4 py-2 rounded-xl bg-black text-white w-full"
        >
          Login
        </button>
        <button
          type="button"
          onClick={showKnownCodes}
          className="px-4 py-2 rounded-xl border w-full"
          title="Show supplier codes saved by Admin"
        >
          I forgot my code
        </button>
      </div>
    </main>
  );
}

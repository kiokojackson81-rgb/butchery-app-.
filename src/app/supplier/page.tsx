// app/supplier/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/** Primary storage keys (match your Admin page) */
const ADMIN_CODES_KEY = "admin_codes";   // People & Codes from Admin
const LEGACY_STAFF_KEYS = ["admin_staff", "admin_staff_v2", "ADMIN_STAFF"]; // optional fallback

type Outlet = "Bright" | "Baraka A" | "Baraka B" | "Baraka C";

/** Matches Admin “People & Codes” structure */
type PersonCode = {
  id: string;
  name: string;
  code: string;
  role: "attendant" | "supervisor" | "supplier";
  active: boolean;
};

/** Legacy staff shape (older admin_staff stores might not have role) */
type LegacyStaff = {
  id: string;
  name: string;
  code: string;
  role?: "attendant" | "supplier" | "supervisor";
  outlet?: Outlet;
  active: boolean;
};

/** Helpers */
function norm(s: string): string {
  return s.replace(/\s+/g, "").trim().toLowerCase();
}

function loadPeople(): PersonCode[] {
  try {
    const raw = localStorage.getItem(ADMIN_CODES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PersonCode[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function loadLegacy(): LegacyStaff[] {
  try {
    for (const key of LEGACY_STAFF_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw) as LegacyStaff[];
        if (Array.isArray(arr)) return arr;
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

    const people = loadPeople();
    const input = norm(code);

    // Preferred: admin_codes with role === "supplier"
    let found = people.find(
      (p) => p.active === true && p.role === "supplier" && norm(p.code) === input
    );

    // Legacy fallback: admin_staff* (role may be missing)
    if (!found) {
      const legacy = loadLegacy();
      const m = legacy.find(
        (s) =>
          s.active === true &&
          (s.role === "supplier" || s.role == null) &&
          norm(s.code) === input
      );
      if (m) {
        found = {
          id: m.id,
          name: m.name,
          code: m.code,
          role: (m.role as PersonCode["role"]) || "supplier",
          active: m.active,
        };
      }
    }

    if (!found) {
      setError("Invalid supplier code.");
      return;
    }

    // Session for dashboard
    sessionStorage.setItem("supplier_code", found.code);
    sessionStorage.setItem("supplier_name", found.name || "Supplier");

    router.push("/supplier/dashboard");
  };

  const showKnownCodes = () => {
    const people = loadPeople();
    const list = people
      .filter((p) => p.role === "supplier")
      .map((p) => `${p.name || "Unnamed"} — ${p.code}${p.active ? "" : " (inactive)"}`);

    if (list.length === 0) {
      const legacy = loadLegacy()
        .filter((s) => s.role === "supplier" || s.role == null)
        .map((s) => `${s.name || "Unnamed"} — ${s.code}${s.active ? "" : " (inactive)"} [legacy]`);
      if (legacy.length === 0) {
        alert("No supplier codes found in localStorage (admin_codes or legacy admin_staff).");
      } else {
        alert("Supplier codes found (legacy):\n\n" + legacy.join("\n"));
      }
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

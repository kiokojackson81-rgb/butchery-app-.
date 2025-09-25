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

  const handleLogin = async () => {
    setError("");
    const input = norm(code);
    if (!input) { setError("Enter your supplier code."); return; }

    // Try API first (DB-backed)
    try {
      const res = await fetch("/api/auth/supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.ok) {
          sessionStorage.setItem("supplier_code", j.code || input);
          sessionStorage.setItem("supplier_name", j.name || "Supplier");
          router.push("/supplier/dashboard");
          return;
        }
      }
    } catch {}

    // Fallback to local lists when API/DB unavailable
    try {
      const people = loadPeople();
      let found = people.find((p) => p.active === true && p.role === "supplier" && norm(p.code) === input);
      if (!found) {
        const legacy = loadLegacy();
        const m = legacy.find((s) => s.active === true && (s.role === "supplier" || s.role == null) && norm(s.code) === input);
        if (m) {
          found = { id: m.id, name: m.name, code: m.code, role: (m.role as PersonCode["role"]) || "supplier", active: m.active } as PersonCode;
        }
      }
      if (found) {
        sessionStorage.setItem("supplier_code", found.code);
        sessionStorage.setItem("supplier_name", found.name || "Supplier");
        router.push("/supplier/dashboard");
        return;
      }
    } catch {}

    setError("Invalid supplier code.");
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Supplier Login</h1>

      <div className="rounded-2xl border p-4 mb-4">
        <input
          className="border rounded-xl p-3 w-full mb-3"
          placeholder="Enter supplier code (e.g. SUPP001)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          onClick={handleLogin}
          className="px-4 py-2 rounded-xl bg-black text-white w-full"
        >
          Login
        </button>
      </div>

      {/* Operational Instructions & Guidelines */}
      <section className="rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Operational Instructions</h2>
        <ol className="list-decimal pl-5 text-sm space-y-2 text-gray-200 md:text-gray-700 md:dark:text-gray-200">
          <li>After login you’ll land on the <span className="font-medium">Supplier Dashboard</span>.</li>
          <li>Select the <span className="font-medium">date</span> and the <span className="font-medium">outlet</span> you are supplying.</li>
          <li>Use <span className="font-medium">Add Item</span> to enter each product’s quantity and buying price. Click <span className="font-medium">Save</span> to store your draft.</li>
          <li>When all supplies are correct, click <span className="font-medium">Submit &amp; Lock</span>. This locks the day’s opening stock for attendants.</li>
          <li>Record any <span className="font-medium">Transfers</span> between outlets (they automatically adjust both outlets’ openings).</li>
          <li>If an adjustment is required after locking, use <span className="font-medium">Request Modification</span> to notify the Supervisor.</li>
          <li>Use <span className="font-medium">Download PDF</span> / <span className="font-medium">Print</span> on the dashboard to get a supply report for filing.</li>
        </ol>
        <p className="text-xs mt-3 text-gray-400 md:text-gray-500">
          Note: Your code is provided by Admin. If you cannot log in, contact the Supervisor or Admin to confirm your active status and code.
        </p>
      </section>
    </main>
  );
}

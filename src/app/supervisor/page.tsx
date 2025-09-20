// app/supervisor/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODES_KEY = "admin_codes";
const LEGACY_STAFF_KEYS = ["admin_staff", "admin_staff_v2", "ADMIN_STAFF"];

type Person = { id: string; name: string; code: string; role: "attendant"|"supervisor"|"supplier"; active: boolean; };
type Legacy = { id: string; name: string; code: string; role?: "attendant"|"supervisor"|"supplier"; active: boolean; };

function norm(s: string){ return s.replace(/\s+/g,"").trim().toLowerCase(); }
function loadPeople(): Person[] {
  try{ const raw = localStorage.getItem(ADMIN_CODES_KEY); return raw ? JSON.parse(raw) : []; } catch{ return []; }
}
function loadLegacy(): Legacy[] {
  try{
    for(const k of LEGACY_STAFF_KEYS){
      const raw = localStorage.getItem(k);
      if(raw){ const arr = JSON.parse(raw); if(Array.isArray(arr)) return arr; }
    }
  }catch{}
  return [];
}

export default function SupervisorLogin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  const login = () => {
    setErr("");
    const input = norm(code);
    const people = loadPeople();
    let found = people.find(p => p.active && p.role==="supervisor" && norm(p.code)===input);

    if(!found){
      const legacy = loadLegacy();
      const m = legacy.find(s => s.active && (s.role==="supervisor" || !s.role) && norm(s.code)===input);
      if(m){
        found = { id:m.id, name:m.name, code:m.code, role:"supervisor", active:m.active };
      }
    }

    if(!found){ setErr("Invalid supervisor code."); return; }

    sessionStorage.setItem("supervisor_code", found.code);
    sessionStorage.setItem("supervisor_name", found.name || "Supervisor");
    router.push("/supervisor/dashboard");
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Supervisor Login</h1>

      <div className="rounded-2xl border p-4 mb-4">
        <input
          className="border rounded-xl p-3 w-full mb-3"
          placeholder="Enter supervisor code (e.g. SUPV001)"
          value={code}
          onChange={(e)=>setCode(e.target.value)}
        />
        {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
        <button className="px-4 py-2 rounded-xl bg-black text-white w-full" onClick={login}>
          Login
        </button>
      </div>

      {/* Guidelines */}
      <section className="rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Operational Guidelines</h2>
        <ol className="list-decimal pl-5 text-sm space-y-2 text-gray-200 md:text-gray-700 md:dark:text-gray-200">
          <li>After login, select a <span className="font-medium">date</span> and <span className="font-medium">outlet</span> (or “All Outlets”).</li>
          <li>Use the <span className="font-medium">Summary</span> cards to review Expected Sales, Deposits, Expenses, Cash at Till, Variance, and Waste.</li>
          <li>Scroll down to <span className="font-medium">Amendment Requests</span> to approve/reject supply/waste/expense/excess-deficit issues.</li>
          <li>Click <span className="font-medium">Download PDF</span> for a printable report of what you are viewing.</li>
          <li>All computations are pulled from the same daily keys the team already uses (no concept changes).</li>
          <li>Use <span className="font-medium">Logout</span> when you’re done or need to switch user.</li>
        </ol>
        <p className="text-xs mt-3 text-gray-400 md:text-gray-500">
          Tip: If a figure seems missing, ensure the relevant team (Supplier/Attendant) has saved or submitted their entries for the day.
        </p>
      </section>
    </main>
  );
}

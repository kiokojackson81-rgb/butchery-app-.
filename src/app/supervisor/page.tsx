"use client";

import React, { useState } from "react";

/** ========= Types ========= */
type Request = {
  id: string;
  date: string;
  outlet: string;
  requestedBy: string;
  type: "supply" | "waste" | "expense" | "deficit" | "excess";
  description: string;
  status: "pending" | "approved" | "rejected";
};

/** ========= Sample Data ========= */
const SAMPLE_REQUESTS: Request[] = [
  {
    id: "r1",
    date: "2025-09-18",
    outlet: "Bright",
    requestedBy: "BR1234",
    type: "waste",
    description: "[Beef] qty=2kg Reason: spoilt meat",
    status: "pending",
  },
  {
    id: "r2",
    date: "2025-09-18",
    outlet: "Baraka A",
    requestedBy: "A1234",
    type: "expense",
    description: "Bought cleaning soap Ksh 200",
    status: "pending",
  },
];

/** ========= Component ========= */
export default function SupervisorDashboard() {
  const [requests, setRequests] = useState<Request[]>(SAMPLE_REQUESTS);

  const handleDecision = (id: string, decision: "approved" | "rejected") => {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: decision } : r))
    );
    alert(`Request ${decision.toUpperCase()} ✅`);
  };

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Supervisor Dashboard</h1>

      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-medium mb-3">Amendment Requests</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Date</th>
                <th className="p-2">Outlet</th>
                <th className="p-2">Requested By</th>
                <th className="p-2">Type</th>
                <th className="p-2">Description</th>
                <th className="p-2">Status</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={7}>
                    No amendment requests.
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.outlet}</td>
                    <td className="p-2">{r.requestedBy}</td>
                    <td className="p-2 capitalize">{r.type}</td>
                    <td className="p-2">{r.description}</td>
                    <td className="p-2">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          r.status === "pending"
                            ? "bg-yellow-200 text-yellow-800"
                            : r.status === "approved"
                            ? "bg-green-200 text-green-800"
                            : "bg-red-200 text-red-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2">
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            className="border rounded-lg px-2 py-1 text-xs bg-green-100"
                            onClick={() => handleDecision(r.id, "approved")}
                          >
                            Approve
                          </button>
                          <button
                            className="border rounded-lg px-2 py-1 text-xs bg-red-100"
                            onClick={() => handleDecision(r.id, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

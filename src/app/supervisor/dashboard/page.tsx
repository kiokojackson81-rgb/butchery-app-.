// src/app/supervisor/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";

/* ================= Keys ================= */
const WASTE_KEY     = "attendant_waste_reviews";    // waste entries needing review
const EXPENSES_KEY  = "attendant_expenses_reviews"; // expenses needing review
const EXCESS_KEY    = "excess_adjustments_reviews"; // excess approval requests
const DEFICIT_KEY   = "deficit_disputes_reviews";   // deficit disputes
const DEPOSITS_KEY  = "attendant_deposits_reviews"; // deposit monitoring

type ReviewItem = {
  id: string;
  date: string;
  outlet: string;
  item?: string;
  amount: number;
  note?: string;
  state: "pending" | "approved" | "rejected";
};

export default function SupervisorDashboard() {
  const [tab, setTab] = useState<
    "waste" | "expenses" | "excess" | "deficit" | "deposits"
  >("waste");

  const [waste, setWaste] = useState<ReviewItem[]>([]);
  const [expenses, setExpenses] = useState<ReviewItem[]>([]);
  const [excess, setExcess] = useState<ReviewItem[]>([]);
  const [deficit, setDeficit] = useState<ReviewItem[]>([]);
  const [deposits, setDeposits] = useState<ReviewItem[]>([]);

  // Load on mount
  useEffect(() => {
    setWaste(read(WASTE_KEY));
    setExpenses(read(EXPENSES_KEY));
    setExcess(read(EXCESS_KEY));
    setDeficit(read(DEFICIT_KEY));
    setDeposits(read(DEPOSITS_KEY));
  }, []);

  const updateState = (
    key: string,
    id: string,
    state: "approved" | "rejected"
  ) => {
    const list = read(key).map((r: ReviewItem) =>
      r.id === id ? { ...r, state } : r
    );
    save(key, list);
    // update local state
    if (key === WASTE_KEY) setWaste(list);
    if (key === EXPENSES_KEY) setExpenses(list);
    if (key === EXCESS_KEY) setExcess(list);
    if (key === DEFICIT_KEY) setDeficit(list);
    if (key === DEPOSITS_KEY) setDeposits(list);
  };

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Supervisor Dashboard</h1>
        <nav className="flex gap-2">
          <TabBtn active={tab === "waste"} onClick={() => setTab("waste")}>
            Waste Review
          </TabBtn>
          <TabBtn active={tab === "expenses"} onClick={() => setTab("expenses")}>
            Expenses Review
          </TabBtn>
          <TabBtn active={tab === "excess"} onClick={() => setTab("excess")}>
            Excess Approvals
          </TabBtn>
          <TabBtn active={tab === "deficit"} onClick={() => setTab("deficit")}>
            Deficit Disputes
          </TabBtn>
          <TabBtn active={tab === "deposits"} onClick={() => setTab("deposits")}>
            Deposits Monitor
          </TabBtn>
        </nav>
      </header>

      {tab === "waste" && <ReviewTable title="Waste Requests" data={waste} onAction={(id, state) => updateState(WASTE_KEY, id, state)} />}
      {tab === "expenses" && <ReviewTable title="Expense Requests" data={expenses} onAction={(id, state) => updateState(EXPENSES_KEY, id, state)} />}
      {tab === "excess" && <ReviewTable title="Excess Approvals" data={excess} onAction={(id, state) => updateState(EXCESS_KEY, id, state)} />}
      {tab === "deficit" && <ReviewTable title="Deficit Disputes" data={deficit} onAction={(id, state) => updateState(DEFICIT_KEY, id, state)} />}
      {tab === "deposits" && (
        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold mb-3">Deposits Monitor</h2>
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b">
                <th className="p-2">Date</th>
                <th>Outlet</th>
                <th>Amount</th>
                <th>Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-2 text-gray-500">
                    No deposits yet.
                  </td>
                </tr>
              )}
              {deposits.map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="p-2">{d.date}</td>
                  <td className="p-2">{d.outlet}</td>
                  <td className="p-2">Ksh {d.amount}</td>
                  <td className="p-2">{d.note || "—"}</td>
                  <td className="p-2">{d.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

/* ===== Review Table ===== */
function ReviewTable({
  title,
  data,
  onAction,
}: {
  title: string;
  data: ReviewItem[];
  onAction: (id: string, state: "approved" | "rejected") => void;
}) {
  return (
    <section className="rounded-2xl border p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-2">Date</th>
            <th>Outlet</th>
            <th>Item</th>
            <th>Amount</th>
            <th>Note</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="p-2 text-gray-500">
                No items to review
              </td>
            </tr>
          )}
          {data.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.date}</td>
              <td className="p-2">{r.outlet}</td>
              <td className="p-2">{r.item || "—"}</td>
              <td className="p-2">Ksh {r.amount}</td>
              <td className="p-2">{r.note || "—"}</td>
              <td className="p-2">{r.state}</td>
              <td className="p-2 flex gap-2">
                {r.state === "pending" && (
                  <>
                    <button
                      onClick={() => onAction(r.id, "approved")}
                      className="text-xs border rounded px-2 py-1 bg-green-600 text-white"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onAction(r.id, "rejected")}
                      className="text-xs border rounded px-2 py-1 bg-red-600 text-white"
                    >
                      Reject
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ===== Helpers ===== */
function read(key: string): ReviewItem[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ReviewItem[]) : [];
  } catch {
    return [];
  }
}
function save(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl border text-sm ${
        active ? "bg-black text-white" : "bg-white"
      }`}
    >
      {children}
    </button>
  );
}

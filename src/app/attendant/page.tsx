// src/app/attendant/page.tsx
"use client";

import { useState, useMemo } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { canonFull } from "@/lib/codeNormalize";

export default function AttendantLoginPage() {
  const [code, setCode] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isDisabled = useMemo(() => loading || code.trim().length === 0, [code, loading]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const raw = code.trim();
    if (!raw) {
      setError("Enter your attendant code.");
      return;
    }

    const norm = canonFull(raw);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ loginCode: norm }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Login failed. Please check your code.");
      }

      try {
        sessionStorage.setItem("attendant_code", norm);
      } catch (err) {
        console.warn("Failed to persist attendant_code", err);
      }

      router.push("/attendant/dashboard");
    } catch (err: any) {
      setError(err?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-[100svh] bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 text-white">
      {/* Header / Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Attendant Portal
            </h1>
            <p className="text-neutral-300 mt-1">
              Log in with your <span className="font-medium">attendant code</span> to open today’s workspace.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 px-4 py-2 text-sm">
            <span className="text-neutral-400">What you’ll manage:</span>{" "}
            Stock • Till deposits • Expenses • Daily summary
          </div>
        </div>
      </section>

      {/* Login Card */}
      <section className="max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Login form */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-2xl">
              <h2 className="text-lg font-semibold">Login</h2>
              <p className="text-sm text-neutral-300 mt-1">
                Enter the code provided by Admin (your code maps you to a specific outlet).
              </p>
              <form className="mt-4 space-y-3" onSubmit={handleLogin}>
                <div>
                  <label className="text-sm text-neutral-400">Attendant Code</label>
                  <input
                    type="text"
                    autoFocus
                    className="input-mobile mt-1 border border-neutral-700 bg-neutral-800/70 rounded-xl w-full p-3 outline-none focus:border-neutral-500"
                    placeholder="e.g. BRIGHT-01"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isDisabled}
                  className={`btn-mobile w-full px-4 py-3 rounded-xl font-medium transition ${
                    isDisabled
                      ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                      : "bg-white text-black hover:bg-neutral-200"
                  }`}
                >
                  {loading ? "Signing in..." : "Continue to Dashboard"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowHelp((s) => !s)}
                  className="btn-mobile w-full text-xs text-neutral-400 underline underline-offset-4 hover:text-neutral-200"
                >
                  {showHelp ? "Hide help" : "I don't know my code"}
                </button>

                {error && (
                  <p className="text-xs text-red-400">{error}</p>
                )}
              </form>

              {showHelp && (
                <div className="mt-3 text-xs text-neutral-300 space-y-1">
                  <p> Ask your supervisor/admin for your unique login code.</p>
                  <p> The code identifies your outlet and which items/tills you manage.</p>
                  <p> If the code fails, it may be inactive-contact admin.</p>
                </div>
              )}

            </div>
          </div>

          {/* Training / What you’ll do today */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
              <h2 className="text-lg font-semibold">Quick Training: Your Daily Flow</h2>
              <div className="grid sm:grid-cols-2 gap-4 mt-3">
                <Card
                  title="1) Stock (Closing & Waste)"
                  points={[
                    "Enter closing weight/units for each item.",
                    "Record any waste (with reason if asked).",
                    "Submit to start a new trading period.",
                  ]}
                />
                <Card
                  title="2) Supply (Read-only)"
                  points={[
                    "View opening stock sent by Supplier.",
                    "Raise a dispute if a quantity looks wrong.",
                    "Supervisor will review disputes.",
                  ]}
                />
                <Card
                  title="3) Deposits"
                  points={[
                    "Paste M-Pesa code or full SMS.",
                    "System validates & reduces Net Till balance.",
                    "Make as many deposits as needed.",
                  ]}
                />
                <Card
                  title="4) Expenses"
                  points={[
                    "Record petty cash expenses (e.g., sharpen).",
                    "Submitted expenses reduce Today Total Sales.",
                  ]}
                />
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 mt-4">
                <h3 className="text-sm font-semibold mb-2">What you’ll see after login</h3>
                <ul className="text-sm text-neutral-300 space-y-1 list-disc pl-5">
                  <li>
                    <span className="font-medium">Active Trading Period</span> — starts when you submit stock; ends at next submit.
                  </li>
                  <li>
                    <span className="font-medium">Till Sales (Net)</span> — Gross till payments minus verified deposits.
                  </li>
                  <li>
                    <span className="font-medium">Amount to Deposit</span> — Today Total Sales minus Net Till.
                  </li>
                  <li>
                    <span className="font-medium">Summary tab</span> — One-tap PDF of the day’s numbers.
                  </li>
                </ul>
              </div>

              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <Badge title="Each outlet has its own till" subtitle="Your code locks you to the right till(s)" />
                <Badge title="Multiple submits per day" subtitle="Each submit closes the current period" />
                <Badge title="Offline-friendly" subtitle="If API is down, your entries are still saved locally" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer note */}
      <section className="max-w-6xl mx-auto px-6 py-8">
        <div className="text-[12px] text-neutral-400">
          By continuing you confirm you are authorized for the assigned outlet. All actions are logged with time.
        </div>
      </section>
    </main>
  );
}

/* ---------- Small presentational helpers (same file) ---------- */

function Card({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-4">
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-2 text-sm text-neutral-300 space-y-1 list-disc pl-5">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-neutral-400 mt-1">{subtitle}</div>
    </div>
  );
}

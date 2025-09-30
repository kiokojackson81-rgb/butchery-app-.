"use client";
import { useState } from "react";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [resp, setResp] = useState<any>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("pending");
    setResp(null);
    try {
      const r = await fetch("/api/wa/portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ code }),
      });
      const j = await r.json();
      setResp(j);
    } catch (e) {
      setResp({ ok: false, reason: "NETWORK" });
    } finally {
      setStatus("done");
    }
  };

  // This is replaced at build-time by Next for NEXT_PUBLIC_* vars
  const waBusiness = resp?.waBusiness || process.env.NEXT_PUBLIC_WA_BUSINESS;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold mb-3">Login with Code</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          className="w-full border rounded-xl p-3"
          placeholder="Enter your code (e.g. BR1234)"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
        <button disabled={status === "pending"} className="px-4 py-2 border rounded-xl">
          {status === "pending" ? "Checking..." : "Submit"}
        </button>
      </form>

      {status === "done" && resp && (
        <div className="mt-6 space-y-3">
          {resp.ok && resp.bound && (
            <>
              <div>✅ Check your WhatsApp — we sent you a menu.</div>
              {waBusiness && (
                <a className="underline" href={`https://wa.me/${waBusiness}`} target="_blank" rel="noreferrer">
                  Open WhatsApp
                </a>
              )}
            </>
          )}

          {resp.ok && !resp.bound && (
            <>
              <div className="space-y-2">
                <div>✅ Almost there. Open WhatsApp and send this exactly:</div>
                <pre className="p-2 rounded bg-neutral-900 text-neutral-100">{resp.token}</pre>
              </div>
              {waBusiness && (
                <a className="underline" href={`https://wa.me/${waBusiness}`} target="_blank" rel="noreferrer">
                  Open WhatsApp
                </a>
              )}
            </>
          )}

          {!resp.ok && (
            <div className="text-red-600">
              {resp.reason === "INVALID_CODE" && "Invalid or inactive code. Contact your supervisor."}
              {resp.reason === "RATE_LIMIT" && "Too many attempts. Try again in a minute."}
              {!["INVALID_CODE", "RATE_LIMIT"].includes(resp.reason) && "Login failed. Try again."}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

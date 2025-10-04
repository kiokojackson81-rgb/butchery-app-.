"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function normalizeCode(v: string) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}

export default function LoginForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (document.getElementById("code-input") as HTMLInputElement | null)?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = (document.getElementById("code-input") as HTMLInputElement | null)?.value || code;
    const loginCode = normalizeCode(raw);
    if (!loginCode) {
      setError("Enter your attendant code.");
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({ loginCode }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Login failed. Please check your code.");
      }
      try {
        sessionStorage.setItem("attendant_code", loginCode);
      } catch (err) {
        console.warn("Failed to persist attendant_code", err);
      }
      router.push("/attendant/dashboard");
    } catch (err: any) {
      setError(String(err?.message || "Login failed. Please try again."));
    } finally {
      setPending(false);
    }
  }

  const disabled = useMemo(() => pending || normalizeCode(code).length === 0, [pending, code]);

  return (
    <div className="mt-6 rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
      <form onSubmit={onSubmit} className="space-y-4">
        <label htmlFor="code-input" className="block text-sm text-white/80">Your login code</label>
        <input
          id="code-input"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          maxLength={24}
          className={cx(
            "w-full rounded-2xl border-0 px-4 py-3 text-base text-white",
            "bg-white/10 ring-1 ring-inset ring-white/20 placeholder:text-white/40",
            "focus:outline-none focus:ring-2 focus:ring-emerald-300"
          )}
          placeholder="e.g. BRIGHT-01"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          type="submit"
          disabled={disabled}
          className={cx(
            "w-full rounded-2xl px-4 py-3 text-base font-semibold",
            disabled ? "bg-white/70 text-emerald-700/70" : "bg-white text-emerald-700",
            "active:scale-[.995] transition"
          )}
        >
          {pending ? "Signing in…" : "Continue to Dashboard"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">{error}</div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function looksLikeCode(v: string) {
  return /^[A-Za-z0-9]{3,10}$/.test(v);
}

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (document.getElementById("code-input") as HTMLInputElement | null)?.focus();
  }, []);

  return (
    <div className="mt-6 rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
      <form
        action={() => {
          start(async () => {
            setError(null);
            const v = (document.getElementById("code-input") as HTMLInputElement | null)?.value || "";
            if (!looksLikeCode(v)) { setError("Invalid code format"); return; }
            const url = new URL(window.location.href);
            const wa = url.searchParams.get("wa") || undefined;
            try {
              const r = await fetch("/api/wa/auth/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ code: v, wa }),
              });
              const j = await r.json().catch(() => ({}));
              if (r.ok && j?.ok) setMsg("Login successful. Check your WhatsApp for next steps.");
              else setMsg("Login failed. Check WhatsApp for help and try again.");
            } catch (e: any) {
              setError(String(e?.message || "Failed"));
            }
          });
        }}
        className="space-y-4"
      >
        <label htmlFor="code-input" className="block text-sm text-white/80">Your login code</label>
        <input
          id="code-input"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          maxLength={10}
          className={cx(
            "w-full rounded-2xl border-0 px-4 py-3 text-base text-white",
            "bg-white/10 ring-1 ring-inset ring-white/20 placeholder:text-white/40",
            "focus:outline-none focus:ring-2 focus:ring-emerald-300"
          )}
          placeholder="e.g. br1234"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          type="submit"
          disabled={pending}
          className={cx(
            "w-full rounded-2xl px-4 py-3 text-base font-semibold",
            "bg-white text-emerald-700 active:scale-[.995] transition",
            pending && "opacity-70"
          )}
        >
          {pending ? "Submitting…" : "Submit code"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">{error}</div>
      )}
      {msg && (
        <div className="mt-4 rounded-xl bg-emerald-400/15 px-4 py-3 text-sm ring-1 ring-emerald-300/30">{msg}</div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function normalizeCode(v: string) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    (document.getElementById("code-input") as HTMLInputElement | null)?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = (document.getElementById("code-input") as HTMLInputElement | null)?.value || code;
    const loginCode = normalizeCode(raw).toUpperCase();
    if (!loginCode) {
      setError("Enter your staff code.");
      return;
    }
    if (!/^[A-Z0-9]{3,10}$/.test(loginCode)) {
      setError("Code should be 3–10 letters or numbers, no spaces.");
      return;
    }
    setPending(true);
    setInfo(null);
  setDeepLink(null);
    try {
      // Validate code, resolve role/outlet, send Welcome+menu, and get pure WA deeplink
      const url = new URL(location.href);
      const wa = url.searchParams.get("wa");
      const r = await fetch("/api/wa/auth/login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: loginCode, src: "web", wa })
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        const ec = j?.code || "GENERIC";
        if (ec === "INVALID_CODE") throw new Error("That code wasn’t found or is inactive. Check with Admin.");
        if (ec === "AMBIGUOUS_CODE") throw new Error("Multiple codes share those digits. Enter the full code (letters + numbers).");
        if (ec === "CODE_NOT_ASSIGNED") throw new Error("Your outlet is not set. Ask Supervisor to assign your outlet.");
        throw new Error(j?.message || "We couldn’t log you in. Try again or contact Admin.");
      }
      const link: string = j?.waDeepLink || "";
      setDeepLink(link);
      try { sessionStorage.setItem("last_login_code", loginCode); } catch {}

      // Show success strip and deep-open WhatsApp immediately
      setInfo("Success. We’re opening WhatsApp and sending your menu…");
      if (link) {
        try { window.location.href = link; } catch {}
      }
    } catch (err: any) {
      setError(String(err?.message || "WhatsApp login is temporarily unavailable."));
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
            disabled ? "bg-white/70 text-emerald-900/70" : "bg-white text-emerald-900",
            "active:scale-[.995] transition"
          )}
        >
          {pending ? "Logging in…" : "Login"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">{error}</div>
      )}

      {info && !error && (
        <div className="mt-3 rounded-xl bg-emerald-400/15 px-4 py-3 text-sm ring-1 ring-emerald-300/30">{info}</div>
      )}

      {/* Single-action UX: no secondary CTAs */}
    </div>
  );
}

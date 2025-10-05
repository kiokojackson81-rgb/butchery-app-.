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
      // Validate code, resolve role/outlet, and get WA deep link (no prefill)
      const r = await fetch("/api/auth/code-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: loginCode })
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Invalid or ambiguous code.");
      }
      const link: string = j?.waDeepLink || "";
      setDeepLink(link);
      try { sessionStorage.setItem("last_login_code", loginCode); } catch {}

      // Replace form with success message per spec; do not auto-redirect.
      setInfo("Login successful! Click below to continue on WhatsApp.");
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
            disabled ? "bg-white/70 text-emerald-700/70" : "bg-white text-emerald-700",
            "active:scale-[.995] transition"
          )}
        >
          {pending ? "Preparing WhatsApp…" : "Open in WhatsApp"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">{error}</div>
      )}

      {info && !error && (
        <div className="mt-3 rounded-xl bg-emerald-400/15 px-4 py-3 text-sm ring-1 ring-emerald-300/30">{info}</div>
      )}

      {deepLink && (
        <div className="mt-4">
          <a href={deepLink} className="block text-center rounded-2xl bg-white text-emerald-700 px-4 py-3 font-semibold" target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
        </div>
      )}

      <div className="mt-6 border-t border-white/10 pt-4 text-xs text-white/80 space-y-2">
        <div className="opacity-80">Already mapped to WhatsApp on this phone?</div>
        <button
          className="w-full rounded-xl bg-white/10 px-4 py-2 ring-1 ring-white/20 hover:bg-white/15 transition"
          onClick={async () => {
            setError(null); setInfo(null);
            const loginCode = normalizeCode(code).toUpperCase();
            if (!/^[A-Z0-9]{3,10}$/.test(loginCode)) { setError("Enter a valid code first."); return; }
            setPending(true);
            try {
              const r = await fetch("/api/wa/portal-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: loginCode }) });
              const j = await r.json().catch(() => ({} as any));
              if (!r.ok || !j?.ok) throw new Error(j?.reason || "Unable to send menu.");
              if (j.bound) setInfo("We sent your WhatsApp menu to your mapped number.");
              else if (j.token) setInfo(`Not yet mapped. In WhatsApp, send: ${j.token}`);
              else setInfo("Check WhatsApp for your login prompt.");
            } catch (e: any) {
              setError(String(e?.message || "Failed to send menu."));
            } finally {
              setPending(false);
            }
          }}
        >
          Send menu to my WhatsApp
        </button>
      </div>
    </div>
  );
}

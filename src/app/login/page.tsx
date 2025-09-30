"use client";

import { useEffect, useMemo, useState } from "react";

// Small helpers
function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function looksLikeCode(v: string) {
  return /^[A-Za-z0-9]{3,10}$/.test(v);
}

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<{ waMe: string; ios: string } | null>(null);
  const [waText, setWaText] = useState<string>("");
  const [finalized, setFinalized] = useState(false);

  // Pull WA business phone for the "Open WhatsApp" link
  const waBusiness = useMemo(() => {
    return process.env.NEXT_PUBLIC_WA_BUSINESS || "";
  }, []);

  // Autofocus on mount (mobile-friendly)
  useEffect(() => {
    const el = document.getElementById("code-input") as HTMLInputElement | null;
    el?.focus();
  }, []);

  const isIOS = () => {
    if (typeof navigator === "undefined") return false;
    return /iP(ad|hone|od)/i.test(navigator.userAgent);
  };

  const goWhatsApp = (links?: { waMe: string; ios: string }) => {
    const target = links ? (isIOS() ? links.ios : links.waMe) : undefined;
    if (!target) return;
    window.location.assign(target);
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!looksLikeCode(code)) {
      setError("Invalid code format");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/flow/login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Login failed");
      setDeepLink(j.links);
      setWaText(j.waText);
      // Attempt to finalize server-side if wa + nonce are present (deep-link roundtrip)
      const url = new URL(window.location.href);
      const wa = url.searchParams.get("wa");
      const nonce = url.searchParams.get("nonce");
      if (wa && nonce && !finalized) {
        // Validate code to fetch role/outlet, then finalize WA auth so we can greet in chat immediately
        const v = await fetch("/api/auth/validate-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const vj = await v.json();
        if (vj?.ok) {
          const fin = await fetch("/api/wa/auth/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phoneE164: wa, nonce, role: vj.role, code: vj.code, outlet: vj.outlet ?? null }),
          });
          const fj = await fin.json();
          if (!fin.ok || !fj?.ok) {
            console.warn("Finalize failed", fj?.error);
          } else {
            setFinalized(true);
          }
        }
      }
      // Open WhatsApp with prefilled LINK <nonce>
      goWhatsApp(j.links);
    } catch (err: any) {
      setError(err?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  // No longer used: deep link flow opens WA directly.

  return (
    <main className="min-h-[100svh] bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-900 text-white">
      {/* Decorative header blob */}
      <div className="relative isolate">
        <svg className="absolute -top-16 -right-20 h-56 w-56 opacity-30" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <path fill="#10B981" d="M46.8,-72.4C58.8,-63.3,65.7,-47.7,71.3,-32.1C76.8,-16.6,81.2,-1.1,78.8,13.1C76.4,27.4,67.2,40.5,55.8,51.2C44.4,61.9,30.8,70.1,16.2,74.6C1.7,79.1,-13.9,79.9,-27.9,74.5C-41.9,69.1,-54.2,57.5,-63.2,44.3C-72.2,31.1,-77.9,16.5,-79.3,1.5C-80.7,-13.5,-77.8,-27.1,-70.9,-39.2C-64,-51.4,-53.2,-61.9,-40.6,-70.4C-28,-79,-14,-85.6,0.6,-86.7C15.1,-87.8,30.3,-83.4,46.8,-72.4Z" transform="translate(100 100)" />
        </svg>

        {/* Content card */}
        <div className="relative z-10 mx-auto max-w-md px-4 pt-14 pb-6">
          {/* Logo / brand */}
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              {/* WhatsApp-ish glyph */}
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white">
                <path fill="currentColor" d="M20 3.5A10 10 0 0 0 4.7 19.1L3 22l3-.8A10 10 0 1 0 20 3.5m-8 17a8.9 8.9 0 0 1-4.5-1.2l-.3-.2l-2.7.7l.7-2.6l-.2-.3A8.9 8.9 0 1 1 12 20.5M7.9 7.9c.2-.6.4-.6.7-.6h.6c.2 0 .5 0 .7.6c.2.6.8 2 .8 2s.1.2 0 .4c0 .2-.1.3-.2.5l-.3.4c-.1.2-.3.3-.1.6c.1.2.6 1 1.3 1.6c.9.8 1.6 1 .1.6c.2-.1.4 0 .6.1l.5.4c.2.2.3.4.5.6c.1.2.1.4 0 .6c0 .2-.5 1.3-1.1 1.3c-.6.1-1.2.1-2-.3c-.8-.4-1.7-1-2.5-1.8a10.5 10.5 0 0 1-1.8-2.5c-.4-.8-.4-1.4-.3-2c.1-.6 1.2-1.1 1.3-1.1c.2 0 .4 0 .6.1Z"/>
              </svg>
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-wide">BarakaOps</h1>
              <p className="text-white/70 text-sm">Login with your code to continue</p>
            </div>
          </div>

          {/* Glass card */}
          <div className="mt-6 rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
            <form onSubmit={onSubmit} className="space-y-4">
              <label htmlFor="code-input" className="block text-sm text-white/80">
                Your login code
              </label>
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

              {/* Submit */}
              <button
                type="submit"
                disabled={busy}
                className={cx(
                  "w-full rounded-2xl px-4 py-3 text-base font-semibold",
                  "bg-white text-emerald-700 active:scale-[.995] transition",
                  busy && "opacity-70"
                )}
              >
                {busy ? "Opening WhatsApp…" : "Submit code"}
              </button>
            </form>
            {/* Errors */}
            {error && (
              <div className="mt-4 rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">
                {error}
              </div>
            )}

            {/* Fallback area if redirect was blocked */}
            {deepLink && (
              <div className="mt-5 space-y-2">
                <div className="text-sm text-white/80">If WhatsApp didn’t open:</div>
                <a
                  href={isIOS() ? deepLink.ios : deepLink.waMe}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-emerald-900 active:scale-[.995]"
                >
                  <WhatsAppIcon />
                  Open WhatsApp
                </a>
                <div className="text-xs text-white/70">
                  We prefilled: <span className="font-mono">{waText}</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer copy */}
          <p className="mt-6 text-center text-xs text-white/60">
            Having trouble? Visit Admin to verify your code or phone mapping.
          </p>
        </div>
      </div>

      {/* Safe-area bottom spacer for mobile */}
      <div className="h-4 sm:h-6" />
    </main>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="currentColor" d="M20 3.5A10 10 0 0 0 4.7 19.1L3 22l3-.8A10 10 0 1 0 20 3.5m-8 17a8.9 8.9 0 0 1-4.5-1.2l-.3-.2l-2.7.7l.7-2.6l-.2-.3A8.9 8.9 0 1 1 12 20.5M7.9 7.9c.2-.6.4-.6.7-.6h.6c.2 0 .5 0 .7.6c.2.6.8 2 .8 2s.1.2 0 .4c0 .2-.1.3-.2.5l-.3.4c-.1.2-.3.3-.1.6c.1.2.6 1 1.3 1.6c.9.8 1.6 1 .1.6c.2-.1.4 0 .6.1l.5.4c.2.2.3.4.5.6c.1.2.1.4 0 .6c0 .2-.5 1.3-1.1 1.3c-.6.1-1.2.1-2-.3c-.8-.4-1.7-1-2.5-1.8a10.5 10.5 0 0 1-1.8-2.5c-.4-.8-.4-1.4-.3-2c.1-.6 1.2-1.1 1.3-1.1c.2 0 .4 0 .6.1Z"/>
    </svg>
  );
}

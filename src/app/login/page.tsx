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
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [resp, setResp] = useState<any>(null);

  // Pull WA business phone for the "Open WhatsApp" link
  const waBusiness = useMemo(() => {
    return resp?.waBusiness || process.env.NEXT_PUBLIC_WA_BUSINESS || "";
  }, [resp]);

  // Autofocus on mount (mobile-friendly)
  useEffect(() => {
    const el = document.getElementById("code-input") as HTMLInputElement | null;
    el?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!looksLikeCode(code)) {
      setResp({ ok: false, reason: "INVALID_CODE" });
      setStatus("done");
      return;
    }
    setStatus("submitting");
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
    } catch (err: any) {
      setResp({ ok: false, reason: "SERVER" });
    } finally {
      setStatus("done");
    }
  }

  const showOpenWa = (resp?.ok && (resp?.bound || resp?.token)) && waBusiness;

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
                disabled={status === "submitting"}
                className={cx(
                  "w-full rounded-2xl px-4 py-3 text-base font-semibold",
                  "bg-white text-emerald-700 active:scale-[.995] transition",
                  status === "submitting" && "opacity-70"
                )}
              >
                {status === "submitting" ? "Checking…" : "Submit code"}
              </button>
            </form>

            {/* Result / helper area */}
            {status === "done" && resp && (
              <div className="mt-4 space-y-3">
                {/* Success: already bound */}
                {resp.ok && resp.bound && (
                  <>
                    <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm ring-1 ring-emerald-300/30">
                      ✅ Code verified — we sent you a menu on WhatsApp.
                    </div>
                    {showOpenWa && (
                      <a
                        href={`https://wa.me/${waBusiness}`}
                        target="_blank"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-emerald-900 active:scale-[.995]"
                      >
                        <WhatsAppIcon />
                        Open WhatsApp
                      </a>
                    )}
                  </>
                )}

                {/* Success: needs binding via LINK token */}
                {resp.ok && !resp.bound && (
                  <>
                    <div className="rounded-xl bg-amber-400/15 px-4 py-3 text-sm ring-1 ring-amber-300/30">
                      ✳️ Almost done — open WhatsApp and send this <b>exactly</b>:
                    </div>
                    <div className="rounded-xl bg-neutral-900 px-4 py-3 font-mono text-emerald-300 ring-1 ring-white/10">
                      {resp.token}
                    </div>
                    {showOpenWa && (
                      <a
                        href={`https://wa.me/${waBusiness}`}
                        target="_blank"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-emerald-900 active:scale-[.995]"
                      >
                        <WhatsAppIcon />
                        Open WhatsApp
                      </a>
                    )}
                  </>
                )}

                {/* Errors */}
                {!resp.ok && (
                  <div className="rounded-xl bg-red-400/15 px-4 py-3 text-sm ring-1 ring-red-300/30">
                    {resp.reason === "INVALID_CODE" && "That code is invalid or inactive. Contact your supervisor."}
                    {resp.reason === "RATE_LIMIT" && "Too many attempts. Please try again in a minute."}
                    {!["INVALID_CODE", "RATE_LIMIT"].includes(resp.reason) && "Login failed. Please try again."}
                  </div>
                )}
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

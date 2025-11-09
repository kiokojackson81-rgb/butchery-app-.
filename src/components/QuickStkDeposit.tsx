"use client";

import * as React from "react";

type Props = {
  outletCode: string;          // e.g. "BRIGHT"
  defaultPhone?: string;       // e.g. "2547XXXXXXXX"
  attendantName?: string;      // for UX only
  defaultAmount?: number | null; // amount picked from summary (optional)
  attendantCode?: string | null; // for special deposit mode tagging
  generalDepositMode?: boolean;  // forces GENERAL_DEPOSIT mode
  onSuccessAction?: () => void | Promise<void>;
};

type StkResponse =
  | {
      ok: true;
      data: {
        MerchantRequestID?: string;
        CheckoutRequestID?: string;
        CustomerMessage?: string;
      };
    }
  | {
      ok: false;
      status: number;
      message?: string;
      data?: any;
    };

function normalizeMsisdn(input: string): string | null {
  const trimmed = input.replace(/\s+/g, "");
  if (/^2547\d{8}$/.test(trimmed)) return trimmed;
  if (/^07\d{8}$/.test(trimmed)) return "254" + trimmed.slice(1);
  if (/^7\d{8}$/.test(trimmed)) return "254" + trimmed;
  return null;
}

export default function QuickStkDeposit({
  outletCode,
  defaultPhone,
  attendantName,
  defaultAmount,
  attendantCode,
  generalDepositMode,
  onSuccessAction,
}: Props) {
  const [phone, setPhone] = React.useState(defaultPhone ?? "");
  const [amount, setAmount] = React.useState<string>(defaultAmount ? String(defaultAmount) : "");
  const [editingAmount, setEditingAmount] = React.useState<boolean>(false);
  const [editingPhone, setEditingPhone] = React.useState<boolean>(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    ok: boolean;
    msg?: string;
    merchant?: string;
    checkout?: string;
  } | null>(null);
  const [resolving, setResolving] = React.useState<boolean>(false);
  const [resolved, setResolved] = React.useState<null | { outletUsed: string; businessShortCode: string; fallback?: boolean; storeNumber?: string; headOfficeNumber?: string }>(null);
  const [confirmFallback, setConfirmFallback] = React.useState<boolean>(false);

  React.useEffect(() => {
    // Keep defaultPhone in sync if parent changes
    if (defaultPhone) setPhone(defaultPhone);
  }, [defaultPhone]);

  React.useEffect(() => {
    let mounted = true;
    async function resolveTill() {
      setResolving(true);
      setResolved(null);
      try {
        const q = new URLSearchParams({ outletCode });
        const r = await fetch(`/api/pay/stk/resolve?${q.toString()}`);
        const j = await r.json();
        if (!mounted) return;
        if (j?.ok) {
          setResolved({ outletUsed: j.outletUsed, businessShortCode: j.businessShortCode, fallback: j.fallback, storeNumber: j.storeNumber, headOfficeNumber: j.headOfficeNumber });
          // reset confirmation when resolve changes
          setConfirmFallback(false);
        } else {
          setResolved(null);
        }
      } catch (e) {
        setResolved(null);
      } finally {
        if (mounted) setResolving(false);
      }
    }
    if (outletCode) resolveTill();
    return () => { mounted = false; };
  }, [outletCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    const msisdn = normalizeMsisdn(phone);
    const amt = Number(amount);

    if (!msisdn) {
      setResult({ ok: false, msg: "Enter a valid phone: 2547XXXXXXXX / 07XXXXXXXX" });
      return;
    }
    if (!amt || amt <= 0) {
      setResult({ ok: false, msg: "Amount must be greater than zero." });
      return;
    }

    if (resolved?.fallback && !confirmFallback) {
      setResult({ ok: false, msg: 'Please confirm deposit to GENERAL till before proceeding.' });
      return;
    }

    setSubmitting(true);
    try {
  const res = await fetch("/api/pay/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
    outletCode,
    phone: msisdn,
    amount: amt,
    category: "DEPOSIT",
    mode: generalDepositMode ? "GENERAL_DEPOSIT" : undefined,
    attendantCode: attendantCode || undefined,
          }),
      });

      const json: StkResponse = await res.json();

      if (json.ok) {
        setResult({
          ok: true,
          msg:
            json.data?.CustomerMessage ??
            "Prompt sent — check your phone to authorize the payment.",
          merchant: json.data?.MerchantRequestID,
          checkout: json.data?.CheckoutRequestID,
        });
          // Reset only if amount was not user-edited
          if (!editingAmount) setAmount("");
        if (onSuccessAction) {
          try { await onSuccessAction(); } catch {}
        }
      } else {
        setResult({
          ok: false,
          msg:
            json.message ??
            `STK request failed (${json.status}). See logs for details.`,
        });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err?.message ?? "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
  <h3 className="text-lg font-semibold">Quick STK Deposit{generalDepositMode ? ' (General Items)' : ''}</h3>
        {attendantName ? (
          <span className="text-xs text-zinc-400">Attendant: {attendantName}</span>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2 mb-2">
          {resolving ? (
            <div className="text-xs text-zinc-400">Resolving till...</div>
          ) : resolved ? (
            <div className="text-xs text-zinc-300">Using till: <span className="font-medium">{resolved.outletUsed}</span> (Shortcode: {resolved.businessShortCode}){resolved.fallback ? ' — fallback to GENERAL' : ''}</div>
          ) : (
            <div className="text-xs text-zinc-500">Till info unavailable</div>
          )}
          {resolved?.fallback ? (
            <div className="mt-2 text-xs text-yellow-300">
              This outlet has no assigned till — deposit will be made to the GENERAL till. Please confirm to proceed.
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs"><input type="checkbox" checked={confirmFallback} onChange={(e) => setConfirmFallback(e.target.checked)} /> <span className="ml-2">I confirm deposit to GENERAL till</span></label>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid gap-1 md:col-span-2">
          <label className="text-sm text-zinc-300">Phone</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              {editingPhone ? (
                <input
                  className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700 w-full"
                  placeholder="2547XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              ) : (
                <div className="rounded-xl bg-zinc-800 px-3 py-2 border border-zinc-700 text-sm">{phone || "No phone assigned"}</div>
              )}
            </div>
            <button type="button" className="text-xs rounded-xl px-3 py-2 border" onClick={() => setEditingPhone((s) => !s)}>{editingPhone ? "Use assigned" : "Change"}</button>
          </div>
        </div>

        <div className="grid gap-1 md:col-span-2">
          <label className="text-sm text-zinc-300">Amount to deposit (KES){generalDepositMode ? ' • special formula' : ''}</label>
          <div className="flex items-center gap-2">
            {editingAmount ? (
              <input
                type="number"
                min={1}
                step="1"
                className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700 w-full"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            ) : (
              <div className="rounded-xl bg-zinc-800 px-3 py-2 border border-zinc-700 text-sm w-full">Ksh {amount || "0"}</div>
            )}
            <button type="button" className="text-xs rounded-xl px-3 py-2 border" onClick={() => setEditingAmount((s) => !s)}>{editingAmount ? "Lock" : "Change amount"}</button>
          </div>
        </div>

        <div className="md:col-span-2 flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-2xl px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Send STK Prompt"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhone(defaultPhone ?? "");
              setAmount(defaultAmount ? String(defaultAmount) : "");
              setEditingAmount(false);
              setEditingPhone(false);
              setResult(null);
            }}
            className="rounded-2xl px-4 py-2 bg-zinc-800 hover:bg-zinc-700"
          >
            Reset
          </button>
        </div>
      </form>

      {result && (
        <div
          className={`mt-4 rounded-xl p-3 text-sm ${
            result.ok ? "bg-emerald-900/30 border border-emerald-700" : "bg-red-900/30 border border-red-700"
          }`}
        >
          <div className="font-medium mb-1">{result.ok ? "Success" : "Failed"}</div>
          {result.msg && <div className="opacity-90">{result.msg}</div>}
          {result.ok && (result.merchant || result.checkout) && (
            <div className="mt-2 text-xs opacity-80">
              {result.merchant && <div>MerchantRequestID: {result.merchant}</div>}
              {result.checkout && <div>CheckoutRequestID: {result.checkout}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

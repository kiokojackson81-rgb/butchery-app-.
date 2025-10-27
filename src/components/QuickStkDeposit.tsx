"use client";

import * as React from "react";

type Props = {
  outletCode: string;          // e.g. "BRIGHT"
  defaultPhone?: string;       // e.g. "2547XXXXXXXX"
  attendantName?: string;      // for UX only
  onSuccess?: () => void | Promise<void>;
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
  onSuccess,
}: Props) {
  const [phone, setPhone] = React.useState(defaultPhone ?? "");
  const [amount, setAmount] = React.useState<string>("");
  const [accountRef, setAccountRef] = React.useState<string>(outletCode ?? "GENERAL");
  const [desc, setDesc] = React.useState<string>("Attendant deposit");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    ok: boolean;
    msg?: string;
    merchant?: string;
    checkout?: string;
  } | null>(null);

  React.useEffect(() => {
    // Keep defaultPhone in sync if parent changes
    if (defaultPhone) setPhone(defaultPhone);
  }, [defaultPhone]);

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

    setSubmitting(true);
    try {
      const res = await fetch("/api/pay/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletCode,                  // server chooses till/passkey based on outlet
          phone: msisdn,               // normalized
          amount: amt,
          accountRef,                  // optional; shows in M-PESA Mini-Statement
          description: desc,           // optional
          category: "DEPOSIT",       // optional hint your route already accepts
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
        setAmount("");
        if (onSuccess) {
          try { await onSuccess(); } catch {}
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
        <h3 className="text-lg font-semibold">Quick STK Deposit</h3>
        {attendantName ? (
          <span className="text-xs text-zinc-400">Attendant: {attendantName}</span>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm text-zinc-300">Phone</label>
          <input
            className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700"
            placeholder="2547XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm text-zinc-300">Amount (KES)</label>
          <input
            type="number"
            min={1}
            step="1"
            className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700"
            placeholder="e.g. 500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm text-zinc-300">Account Ref (optional)</label>
          <input
            className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700"
            placeholder={outletCode}
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm text-zinc-300">Description (optional)</label>
          <input
            className="rounded-xl bg-zinc-800 px-3 py-2 outline-none border border-zinc-700"
            placeholder="Attendant deposit"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
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
              setAmount("");
              setAccountRef(outletCode ?? "GENERAL");
              setDesc("Attendant deposit");
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

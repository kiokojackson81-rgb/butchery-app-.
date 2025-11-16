"use client";
import React, { useEffect, useState } from 'react';

// Pings a set of critical endpoints periodically and displays latency + status.
// Lightweight: uses HEAD where supported, falls back to GET.
export function HealthWidget({ date, outlet }: { date: string; outlet: string }) {
  type EP = { key: string; url: string; label: string };
  const endpoints: EP[] = [
    { key: 'overview', url: `/api/supervisor/overview?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet||'__ALL__')}`, label: 'Overview' },
    { key: 'payments', url: `/api/payments/till?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet||'__ALL__')}&period=previous&sort=createdAt:desc&status=ALL&take=1`, label: 'Payments' },
    { key: 'reviews', url: `/api/supervisor/reviews?type=waste&limit=1`, label: 'Reviews' },
  ];
  const [results, setResults] = useState<Record<string, { ms: number; ok: boolean }>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const out: Record<string, { ms: number; ok: boolean }> = {};
      await Promise.all(endpoints.map(async (e) => {
        const t0 = performance.now();
        try {
          const method = 'HEAD';
          let res = await fetch(e.url, { method, cache: 'no-store' });
          if (!res.ok && res.status === 405) {
            // HEAD not allowed fallback to GET minimal
            res = await fetch(e.url, { cache: 'no-store' });
          }
          const t1 = performance.now();
          out[e.key] = { ms: Math.round(t1 - t0), ok: res.ok };
        } catch {
          const t1 = performance.now();
          out[e.key] = { ms: Math.round(t1 - t0), ok: false };
        }
      }));
      if (!cancel) setResults(out);
    })();
    const id = setInterval(() => setTick(t => t + 1), 30000); // every 30s
    return () => { cancel = true; clearInterval(id); };
  }, [date, outlet, tick]);

  return (
    <div className="flex flex-wrap gap-2 mt-3" aria-label="Endpoint health">
      {endpoints.map(ep => {
        const r = results[ep.key];
        const cls = !r ? 'bg-gray-600' : r.ok ? (r.ms < 400 ? 'bg-green-600' : 'bg-amber-600') : 'bg-red-600';
        return (
          <div key={ep.key} className={`px-2 py-1 rounded-full text-xs text-white flex items-center gap-1 ${cls}`}
               title={`${ep.label}: ${r ? (r.ok ? 'OK' : 'FAIL') + ' ' + r.ms + 'ms' : 'pending'}`}
          >
            <span>{ep.label}</span>
            {r && <span>{r.ms}ms</span>}
          </div>
        );
      })}
    </div>
  );
}

export default HealthWidget;
"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';

type Toast = { id: number; type: 'success'|'error'|'info'; message: string };

const ToastContext = createContext<{ showToast: (t: Omit<Toast,'id'>) => void } | undefined>(undefined);

export function ToastProvider({ children, autoDismissMs = 3500 }: { children: React.ReactNode; autoDismissMs?: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t => setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id));
    }, autoDismissMs));
    return () => timers.forEach(clearTimeout);
  }, [toasts, autoDismissMs]);

  function showToast(payload: Omit<Toast,'id'>) {
    const id = Date.now() + Math.floor(Math.random()*1000);
    setToasts(prev => [...prev, { ...payload, id }]);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t, i) => (
          <div
            key={t.id}
            className={`pointer-events-auto transform transition-all duration-300 ease-out px-4 py-2 rounded shadow-lg text-sm flex items-center gap-2 ${t.type === 'success' ? 'bg-emerald-600 text-white' : t.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white'}`}
            style={{
              willChange: 'transform, opacity',
              transitionDelay: `${i * 40}ms`,
            }}
            data-testid={`toast-${t.id}`}
          >
            <div className="flex-1">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

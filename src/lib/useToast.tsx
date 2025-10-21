"use client";
import { useEffect, useState } from 'react';
import { registerAdminToast } from './toast';

export default function useToast(initial: string | null = null) {
  const [toast, setToast] = useState<string | null>(initial);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    try { registerAdminToast((m: string|null) => { setToast(m); }); } catch {}
    return () => { try { registerAdminToast(null); } catch {} };
  }, []);

  return [toast, setToast] as const;
}

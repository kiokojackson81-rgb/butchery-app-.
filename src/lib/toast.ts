// Centralized toast helper used across admin/client pages
export type AdminToastSetter = (msg: string | null) => void;

let adminSetter: AdminToastSetter | null = null;

export function registerAdminToast(setter: AdminToastSetter | null) {
  adminSetter = setter;
}

export function notifyToast(msg: string | null) {
  try {
    if (typeof window !== 'undefined' && (adminSetter as any)) {
      (adminSetter as AdminToastSetter)(msg);
      return;
    }
  } catch {}
  // Fallback to console when running in non-DOM or tests
  try { console.log('toast:', msg); } catch {}
}

export function setAdminToastGlobal(msg: string | null) {
  notifyToast(msg);
}

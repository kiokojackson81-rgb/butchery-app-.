// src/lib/apiGuard.ts
// Lightweight protection for sensitive API routes.
// If the given env var is set, require matching header or query param.

export function isAuthorizedByKey(req: Request, envVar: string, headerName = "x-admin-key", qsParam = "key"): boolean {
  const secret = (process.env as any)?.[envVar];
  if (!secret) return true; // no lock if not configured
  try {
    const headerVal = req.headers.get(headerName) || "";
    if (headerVal && headerVal === secret) return true;
  } catch {}
  try {
    const url = new URL(req.url);
    const qsVal = url.searchParams.get(qsParam) || "";
    if (qsVal && qsVal === secret) return true;
  } catch {}
  return false;
}

// Simple in-memory sliding window rate limiter keyed by client IP.
// Note: Suitable for single-instance deployments. For multi-instance,
// back with a shared store (Redis) or edge middleware.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for") || "";
  const xr = req.headers.get("x-real-ip") || "";
  const cand = (xf.split(",")[0] || xr || "").trim();
  return cand || "unknown";
}

export function rateLimit(req: Request, keyPrefix: string, limit = 10, windowMs = 60_000) {
  const ip = getClientIp(req);
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    return { allowed: false as const, retryAfter: Math.max(0, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { allowed: true as const };
}

// src/lib/normalizeCode.ts
export function normalizeCode(raw: string) {
  return (raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

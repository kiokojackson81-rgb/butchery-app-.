// src/server/util/normalize.ts
// Shared normalization helpers for codes and phone numbers.

// Normalize a login code: trim and uppercase
export function normCode(raw: string) {
  return (raw || "").trim().toUpperCase();
}

// Store E.164 with leading + in DB
export function toDbPhone(e: string) {
  return e.startsWith("+") ? e : `+${e}`;
}

// Graph API format expects E.164 without +
export function toGraphPhone(e: string) {
  return String(e || "").replace(/^\+/, "");
}

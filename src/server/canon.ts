// src/server/canon.ts
// Canonical helpers for codes and phone numbers. Use these everywhere for normalization.

export function canonFull(input: string): string {
  if (!input) return "";
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

export function canonNum(input: string): string {
  if (!input) return "";
  return input.replace(/\D+/g, "");
}

// For phone numbers: +E.164 for DB, Graph requires no "+" on "to"
export function toE164DB(input: string): string {
  const digits = canonNum(input);
  return digits ? `+${digits}` : "";
}

export function toGraphPhone(input: string): string {
  return canonNum(input); // "2547..."
}

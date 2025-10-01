// Shared helpers for tolerant code matching
// - canonFull: lowercase, trim, remove all whitespace
// - canonNum: digits-only core

export function canonFull(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function canonNum(raw: string): string {
  return (String(raw || "").match(/\d+/g) || []).join("");
}

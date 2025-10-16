// Shared helpers for tolerant code matching
// - canonFull: lowercase, trim, remove all whitespace
// - canonNum: digits-only core

export function canonFull(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function canonNum(raw: string): string {
  return (String(raw || "").match(/\d+/g) || []).join("");
}

// Spec-compliant helper alias
export function normalizeCode(input: string): string {
  const trimmed = String(input || "").trim();
  return trimmed.toLowerCase().replace(/\s+/g, "");
}

// Extra-tolerant canonicalizer for user input: lowercase and remove ALL non-alphanumerics.
// Example: "Jackson A" => "jacksona", "JACKSON-A" => "jacksona"
export function canonLoose(input: string): string {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]+/gi, "");
}

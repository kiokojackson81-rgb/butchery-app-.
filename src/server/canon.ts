// src/server/canon.ts
// Canonical helpers for codes and phone numbers. Delegates to the shared normalize helpers
// under src/lib/codeNormalize.ts so there is a single definition across the stack.

import { canonFull as canonFullBase, canonNum as canonNumBase } from "@/lib/codeNormalize";

export const canonFull = (input: string): string => canonFullBase(input);
export const canonNum = (input: string): string => canonNumBase(input);

// For phone numbers: +E.164 for DB, Graph requires no "+" on "to"
export function toE164DB(input: string): string {
  const digits = canonNumBase(input);
  return digits ? `+${digits}` : "";
}

export function toGraphPhone(input: string): string {
  return canonNumBase(input); // "2547..."
}

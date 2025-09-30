// lib/wa_phone.ts
export function normalizeToPlusE164(anyPhone: string) {
  const digits = String(anyPhone || "").replace(/[^\d]/g, "");
  if (!digits) return "+";
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  return `+${digits}`;
}

export function toGraphPhone(plusE164: string) {
  return String(plusE164 || "").replace(/^\+/, "");
}

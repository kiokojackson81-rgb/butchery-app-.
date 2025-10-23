const GENERAL_KEYWORDS = new Set(['potatoes','mutura','samosa','samosas','chips','fries']);

// Return string values matching prisma enum OutletCode ('BRIGHT'|'BARAKA_A'|'BARAKA_B'|'BARAKA_C'|'GENERAL')
export function resolveOutletForCategory(category: string | undefined, attendantOutlet?: string): string {
  if (!category) return attendantOutlet || 'BRIGHT';
  const c = String(category).toLowerCase().trim();
  if (GENERAL_KEYWORDS.has(c)) return 'GENERAL';
  return attendantOutlet || 'BRIGHT';
}

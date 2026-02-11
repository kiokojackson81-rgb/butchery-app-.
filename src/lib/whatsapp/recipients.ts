export type OutletKey = 'BRIGHT' | 'BARAKA_A' | 'BARAKA_B' | 'BARAKA_C';

export function recipientsFor(outlet: OutletKey) {
  const admin = (process.env.ADMIN_PHONE || '').trim();
  const supA = (process.env.SUPERVISOR_BARAKA_A || '').trim();
  const kyalo = (process.env.KYALO_PHONE || '').trim();

  const nightly: string[] = [];
  const highValue: string[] = [];
  if (admin) { nightly.push(admin); highValue.push(admin); }

  if (outlet === 'BARAKA_A') {
    if (supA) { nightly.push(supA); highValue.push(supA); }
    if (kyalo) nightly.push(kyalo);
  }

  return {
    nightly: Array.from(new Set(nightly)).filter(Boolean),
    highValue: Array.from(new Set(highValue)).filter(Boolean),
  } as const;
}

export function outletLabel(outlet: OutletKey) {
  if (outlet === 'BARAKA_A') return 'Baraka A';
  if (outlet === 'BARAKA_B') return 'Baraka B';
  if (outlet === 'BARAKA_C') return 'Baraka C';
  return 'Bright';
}

export default { recipientsFor, outletLabel };


import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { prisma } from '@/lib/prisma';
import { canonFull } from '@/lib/codeNormalize';

type StaffPayload = {
  id: string;
  code: string;
  name: string;
  outlet: string;
  products: string[];
  active: boolean;
};

function normalizeProductKeys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeOutlet(outlet: unknown): string {
  return typeof outlet === 'string' ? outlet : '';
}

export async function GET() {
  try {
    const assignments = await prisma.attendantAssignment.findMany();
    const personCodes = await prisma.personCode.findMany({ where: { role: 'attendant' } });

    const codeSet = new Set<string>();
    for (const assignment of assignments as any[]) {
      if (assignment?.code) codeSet.add(canonFull(assignment.code));
    }
    for (const person of personCodes as any[]) {
      if (person?.code) codeSet.add(canonFull(person.code));
    }
    const codes = Array.from(codeSet);

    const attendants = codes.length
      ? await prisma.attendant.findMany({ where: { loginCode: { in: codes } } })
      : [];

    const personByCode = new Map<string, any>();
    for (const person of personCodes as any[]) {
      if (person?.code) personByCode.set(canonFull(person.code), person);
    }

    const assignmentByCode = new Map<string, any>();
    for (const assignment of assignments as any[]) {
      if (assignment?.code) assignmentByCode.set(canonFull(assignment.code), assignment);
    }

    const attendantByCode = new Map<string, any>();
    for (const attendant of attendants as any[]) {
      if (attendant?.loginCode) attendantByCode.set(canonFull(attendant.loginCode), attendant);
    }

    const staff: StaffPayload[] = codes.map((code) => {
      const person = personByCode.get(code);
      const assignment = assignmentByCode.get(code);
      const attendant = attendantByCode.get(code);
      const id = (person?.id as string | undefined) || (attendant?.id as string | undefined) || code;
      const name = attendant?.name || person?.name || code;
      const outlet = normalizeOutlet(assignment?.outlet);
      const products = normalizeProductKeys(assignment?.productKeys);
      const active = person?.active !== false;

      return {
        id,
        code,
        name,
        outlet,
        products,
        active,
      };
    });

    return NextResponse.json({ ok: true, staff });
  } catch (error: any) {
    console.error('failed to load admin staff', error);
    return NextResponse.json({ ok: false, error: String(error?.message ?? error) }, { status: 500 });
  }
}

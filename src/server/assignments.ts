import { prisma } from "@/lib/prisma";
import { canonFull } from "@/server/canon";
import { sendText } from "@/lib/wa";
import { sendOpsMessage } from "@/lib/wa_dispatcher";
import { getLoginLinkFor } from "@/server/wa_links";

export type AssignmentSnapshot = {
  outlet: string | null;
  productKeys: string[];
};

function uniqueSorted(keys: string[]): string[] {
  const set = new Set<string>();
  for (const raw of keys) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set).sort();
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function assignmentChanged(before: AssignmentSnapshot, after: AssignmentSnapshot): boolean {
  if ((before.outlet || null) !== (after.outlet || null)) return true;
  if (!arraysEqual(before.productKeys, after.productKeys)) return true;
  return false;
}

export async function getAssignmentSnapshot(codeRaw: string): Promise<AssignmentSnapshot> {
  const code = canonFull(codeRaw || "");
  if (!code) return { outlet: null, productKeys: [] };

  const scope = await prisma.attendantScope.findFirst({
    where: { codeNorm: code },
    include: { products: true },
  }).catch(() => null);

  if (scope) {
    const keys = scope.products
      .map((p: any) => String(p?.productKey || ""))
      .filter((k) => k.length > 0)
      .sort();
    return { outlet: scope.outletName || null, productKeys: keys };
  }

  const assignment = await prisma.attendantAssignment.findUnique({ where: { code } }).catch(() => null);
  if (assignment) {
    const rawKeys = Array.isArray((assignment as any).productKeys)
      ? ((assignment as any).productKeys as any[])
      : [];
    const keys = rawKeys.map((k) => String(k || "")).filter((k) => k.length > 0).sort();
    return { outlet: (assignment as any).outlet || null, productKeys: keys };
  }

  return { outlet: null, productKeys: [] };
}

async function resolveOutletName(outletRaw: string): Promise<string> {
  const name = (outletRaw || "").trim();
  if (!name) return "";
  // Try to find by case-insensitive name first
  const existing = await prisma.outlet.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  }).catch(() => null);
  if (existing?.name) return existing.name;
  // Create an Outlet row to ensure downstream login can resolve outletId
  const created = await prisma.outlet.create({
    data: { name, code: canonFull(name), active: true },
    select: { name: true },
  }).catch(() => null);
  return created?.name || name;
}

async function formatProductList(keys: string[]): Promise<string> {
  if (!keys.length) return "no products";
  const rows = await prisma.product.findMany({ where: { key: { in: keys } } }).catch(() => []);
  const labelByKey = new Map<string, string>();
  for (const row of rows as any[]) {
    if (row?.key) labelByKey.set(row.key, row.name || row.key);
  }
  return keys.map((k) => labelByKey.get(k) ?? k).join(", ");
}

async function resolvePhoneAndName(codeRaw: string) {
  const code = canonFull(codeRaw || "");
  const pm = await prisma.phoneMapping.findUnique({ where: { code } }).catch(() => null);
  const pc = await prisma.personCode.findFirst({ where: { code, active: true } }).catch(() => null);
  const att = await prisma.attendant.findFirst({ where: { loginCode: code } }).catch(() => null);
  const name = att?.name || pc?.name || codeRaw;
  const phoneE164 = pm?.phoneE164 || null;
  return { phoneE164, name };
}

export async function upsertAssignmentForCode(codeRaw: string, outletRaw: string, productKeys: string[]) {
  const code = canonFull(codeRaw || "");
  if (!code) throw new Error("Invalid code");

  const before = await getAssignmentSnapshot(code);
  const outletName = await resolveOutletName(outletRaw);
  const keys = uniqueSorted(productKeys);

  await prisma.$transaction(async (tx) => {
    const scope = await tx.attendantScope.upsert({
      where: { codeNorm: code },
      create: { codeNorm: code, outletName },
      update: { outletName },
    });

    await tx.scopeProduct.deleteMany({ where: { scopeId: scope.id } });
    if (keys.length) {
      await tx.scopeProduct.createMany({
        data: keys.map((productKey) => ({ scopeId: scope.id, productKey })),
        skipDuplicates: true,
      });
    }

    await tx.attendantAssignment.upsert({
      where: { code },
      update: { outlet: outletName, productKeys: keys },
      create: { code, outlet: outletName, productKeys: keys },
    });
  });

  const after = await getAssignmentSnapshot(code);
  const changed = assignmentChanged(before, after);
  return { canonicalCode: code, before, after, changed };
}

export async function notifyAttendantAssignmentChange(codeRaw: string, opts?: {
  before?: AssignmentSnapshot | null;
  after?: AssignmentSnapshot | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const code = canonFull(codeRaw || "");
  if (!code) return { sent: false, reason: "bad-code" };

  const afterSnapshot = opts?.after ?? (await getAssignmentSnapshot(code));
  if (!afterSnapshot.outlet && afterSnapshot.productKeys.length === 0) {
    return { sent: false, reason: "no-scope" };
  }

  const beforeSnapshot = opts?.before ?? null;
  if (beforeSnapshot && !assignmentChanged(beforeSnapshot, afterSnapshot)) {
    return { sent: false, reason: "no-change" };
  }

  const { phoneE164, name } = await resolvePhoneAndName(code);
  if (!phoneE164) {
    console.warn(`[notifyAssign] No phone mapping for code ${code}. Skipping DM.`);
    return { sent: false, reason: "no-phone" };
  }

  const productList = await formatProductList(afterSnapshot.productKeys);
  const url = await getLoginLinkFor(phoneE164);
  const outletText = afterSnapshot.outlet ? ` at ${afterSnapshot.outlet}` : "";
  const message = `Welcome ${name} — you’ve been assigned to manage ${productList}${outletText}.\nLogin to start managing: ${url}`;

  if (process.env.WA_AUTOSEND_ENABLED === "true") {
    if (process.env.WA_AUTOSEND_ENABLED === "true") {
  const result = await sendText(phoneE164, message, "AI_DISPATCH_TEXT");
      if (!result.ok) {
        console.error(`[notifyAssign] send failed for ${code}: ${result.error}`);
        return { sent: false, reason: "send-failed" };
      }
    } else {
      try { await sendOpsMessage(phoneE164, { kind: "assignment_notice", role: "attendant", outlet: afterSnapshot.outlet || "" }); } catch {}
    }
  }

  return { sent: true };
}



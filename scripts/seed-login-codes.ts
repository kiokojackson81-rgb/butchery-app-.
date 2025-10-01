import { prisma } from "@/lib/prisma";
import { canonFull } from "@/lib/codeNormalize";

type AdminPerson = { role: "attendant" | "supervisor" | "supplier"; code: string; name?: string; active?: boolean };

async function upsertSettingArray(key: string, nextItems: any[], keyField: string) {
  const cur = await (prisma as any).setting.findUnique({ where: { key } });
  const arr: any[] = Array.isArray(cur?.value) ? (cur as any).value : [];
  const byKey = new Map(arr.map((i: any) => [String(i?.[keyField]), i]));
  for (const item of nextItems) byKey.set(String(item?.[keyField]), { ...(byKey.get(String(item?.[keyField])) || {}), ...item });
  const merged = Array.from(byKey.values());
  await (prisma as any).setting.upsert({ where: { key }, update: { value: merged }, create: { key, value: merged } });
}

async function main() {
  const code = canonFull("001a");
  const outletName = "Baraka A";

  // 1) Outlet
  const outlet = await (prisma as any).outlet.upsert({
    where: { name: outletName },
    update: {},
    create: { name: outletName, code: canonFull(outletName) },
  });

  // 2) Attendant + LoginCode for view/demo
  const attendant = await (prisma as any).attendant.upsert({
    where: { loginCode: code },
    update: { outletId: outlet.id },
    create: { name: "QA Attendant", outletId: outlet.id, loginCode: code },
  });
  await (prisma as any).loginCode.upsert({
    where: { code },
    update: { attendantId: attendant.id },
    create: { code, attendantId: attendant.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });

  // 3) AttendantAssignment used by /api/auth/attendant
  await (prisma as any).attendantAssignment.upsert({
    where: { code },
    update: { outlet: outletName, productKeys: ["beef", "goat"] },
    create: { code, outlet: outletName, productKeys: ["beef", "goat"] },
  });

  // 4) admin_codes: supervisor + supplier using same visible code
  const people: AdminPerson[] = [
    { role: "supervisor", code, name: "QA Supervisor", active: true },
    { role: "supplier", code, name: "QA Supplier", active: true },
  ];
  const curCodes = await (prisma as any).setting.findUnique({ where: { key: "admin_codes" } });
  const list: AdminPerson[] = Array.isArray(curCodes?.value) ? (curCodes as any).value : [];
  const filtered = list.filter((p) => !(p.role === "supervisor" && canonFull(p.code) === code) && !(p.role === "supplier" && canonFull(p.code) === code));
  const merged = [...filtered, ...people];
  await (prisma as any).setting.upsert({ where: { key: "admin_codes" }, update: { value: merged }, create: { key: "admin_codes", value: merged } });

  // 5) admin_outlets mirror
  await upsertSettingArray(
    "admin_outlets",
    [{ name: outletName, code: canonFull(outletName), active: true }],
    "name"
  );

  console.log("Seeded:", { code, outlet: outletName });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { beforeEach, describe, expect, it, vi } from "vitest";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

type PersonRow = {
  id: string;
  code: string;
  name: string;
  role: string;
  active: boolean;
};

type SettingValue = unknown;

declare module "@/lib/prisma" {
  // Augment module typing for the mock store export
  export const __store: {
    personCodesById: Map<string, PersonRow>;
    personCodesByCode: Map<string, string>;
    settings: Map<string, SettingValue>;
  };
}

vi.mock("@/lib/prisma", () => {
  const personCodesById = new Map<string, PersonRow>();
  const personCodesByCode = new Map<string, string>();
  const settings = new Map<string, SettingValue>();
  let idCounter = 1;

  const prisma = {
    $queryRaw: vi.fn(async () => []),
    personCode: {
      findMany: vi.fn(async () => Array.from(personCodesById.values())),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PersonRow> }) => {
        const existing = personCodesById.get(where.id);
        if (!existing) throw new Error("personCode not found");
        const next: PersonRow = {
          ...existing,
          ...data,
          code: typeof data.code === "string" ? data.code : existing.code,
          name: typeof data.name === "string" ? data.name : existing.name,
          role: typeof data.role === "string" ? data.role : existing.role,
          active: typeof data.active === "boolean" ? data.active : existing.active,
        };
        personCodesById.set(where.id, next);
        personCodesByCode.set(next.code, where.id);
        return next;
      }),
      create: vi.fn(async ({ data }: { data: PersonRow }) => {
        const id = data.id ?? `pc-${idCounter++}`;
        const row: PersonRow = {
          id,
          code: data.code,
          name: data.name ?? "",
          role: data.role ?? "attendant",
          active: data.active ?? true,
        };
        personCodesById.set(id, row);
        personCodesByCode.set(row.code, id);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { code: string } }) => {
        const id = personCodesByCode.get(where.code);
        if (!id) throw new Error("personCode missing");
        const existing = personCodesById.get(id)!;
        personCodesById.delete(id);
        personCodesByCode.delete(where.code);
        return existing;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { code?: string } }) => {
        if (where?.code) {
          const id = personCodesByCode.get(where.code);
          if (!id) return { count: 0 };
          personCodesByCode.delete(where.code);
          personCodesById.delete(id);
          return { count: 1 };
        }
        const count = personCodesById.size;
        personCodesById.clear();
        personCodesByCode.clear();
        return { count };
      }),
    },
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (!settings.has(where.key)) return null;
        return { value: settings.get(where.key) };
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { key: string }; update: { value: any }; create: { key: string; value: any } }) => {
        const nextValue = update?.value ?? create?.value;
        settings.set(where.key, nextValue);
        return { key: where.key, value: nextValue };
      }),
    },
    phoneMapping: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    waSession: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    attendant: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: `att-${idCounter++}` })),
    },
    session: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    loginCode: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    outlet: {
      upsert: vi.fn(async () => ({ id: `out-${idCounter++}`, name: "", code: "", active: true })),
    },
    attendantAssignment: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    attendantScope: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({ id: `scope-${idCounter++}`, outletName: "" })),
    },
    scopeProduct: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  } as const;

  return { prisma, __store: { personCodesById, personCodesByCode, settings } };
});

vi.mock("@/server/assignments", () => ({
  upsertAssignmentForCode: vi.fn(async (code: string, outlet: string, productKeys: string[]) => ({
    canonicalCode: normalize(code),
    before: null,
    after: { outlet, productKeys },
    changed: false,
  })),
  notifyAttendantAssignmentChange: vi.fn(async () => {}),
}));

import { normalizeCode } from "../src/lib/codeNormalize";
import { __store } from "@/lib/prisma";
import { POST as saveCodesRoute } from "../src/app/api/admin/attendants/upsert/route";
import { POST as saveSettingRoute } from "../src/app/api/settings/[key]/route";

function makeCodesRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/attendants/upsert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const settingsContext = { params: Promise.resolve({ key: "admin_codes" }) };

function makeSettingsRequest(value: unknown): Request {
  return new Request("http://localhost/api/settings/admin_codes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

beforeEach(() => {
  __store.personCodesById.clear();
  __store.personCodesByCode.clear();
  __store.settings.clear();
});

describe("admin codes persistence", () => {
  it("removes codes from the database when they are dropped in admin save", async () => {
    const canonicalA = normalizeCode("CODE-A");
    const canonicalB = normalizeCode("CODE-B");

    __store.personCodesById.set("pc-1", { id: "pc-1", code: canonicalA, name: "Alpha", role: "attendant", active: true });
    __store.personCodesById.set("pc-2", { id: "pc-2", code: canonicalB, name: "Beta", role: "supervisor", active: true });
    __store.personCodesByCode.set(canonicalA, "pc-1");
    __store.personCodesByCode.set(canonicalB, "pc-2");
    __store.settings.set("admin_codes", [
      { code: "CODE-A", name: "Alpha", role: "attendant", active: true },
      { code: "CODE-B", name: "Beta", role: "supervisor", active: true },
    ]);

    const postRemovalPeople = [
      { code: "CODE-A", name: "Alpha", role: "attendant", active: true },
    ];

    await saveSettingRoute(makeSettingsRequest(postRemovalPeople), settingsContext);

    const response = await saveCodesRoute(makeCodesRequest({ people: postRemovalPeople }));
    const payload = await response.json() as { ok: boolean; [key: string]: unknown };
    expect(payload.ok).toBe(true);

    expect(__store.personCodesByCode.has(canonicalA)).toBe(true);
    expect(__store.personCodesByCode.has(canonicalB)).toBe(false);

    const settingValue = __store.settings.get("admin_codes");
    expect(settingValue).toEqual(postRemovalPeople);
  });
});

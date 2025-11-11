import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const mock = {
    attendantClosing: { findMany: vi.fn() },
    supplyOpeningRow: { findMany: vi.fn() },
    pricebookRow: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    attendantExpense: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { prisma: mock };
});

vi.mock("@/server/assignments", () => ({
  getAssignmentSnapshot: vi.fn(async () => ({ outlet: "OutletA", productKeys: ["beef"] })),
}));

vi.mock("@/server/trading_period", async () => {
  const actual = await vi.importActual<typeof import("@/server/trading_period")>("@/server/trading_period");
  return { ...actual, getPeriodState: vi.fn(async () => "OPEN") };
});

import { computeAssistantExpectedDeposit } from "@/server/assistant";

describe("computeAssistantExpectedDeposit", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("computes sales minus expenses with no deposits", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 100 }]) // previous day
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 60 }]); // current day
    (prisma.supplyOpeningRow.findMany as any).mockResolvedValue([{ itemKey: "beef", qty: 0 }]);
    (prisma.pricebookRow.findMany as any).mockResolvedValue([{ productKey: "beef", sellPrice: 10, active: true }]);
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", sellPrice: 10, active: true }]);
    (prisma.attendantExpense.findMany as any).mockResolvedValue([]);
    (prisma.$queryRaw as any).mockResolvedValue([]);

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-01",
      respectAllowlist: false,
    });

    expect(res.ok).toBe(true);
    expect(res.salesValue).toBe(400);
    expect(res.expensesValue).toBe(0);
    expect(res.expected).toBe(400);
    expect(res.recommendedNow).toBe(400);
  });

  it("subtracts expenses and prior deposits", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 80 }])
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 40 }]);
    (prisma.supplyOpeningRow.findMany as any).mockResolvedValue([{ itemKey: "beef", qty: 0 }]);
    (prisma.pricebookRow.findMany as any).mockResolvedValue([{ productKey: "beef", sellPrice: 10, active: true }]);
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", sellPrice: 10, active: true }]);
    (prisma.attendantExpense.findMany as any).mockResolvedValue([{ amount: 50 }]);
    (prisma.$queryRaw as any).mockResolvedValue([{ amount: 200, status: "VALID" }]);

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-02",
      respectAllowlist: false,
    });

    expect(res.salesValue).toBe(400);
    expect(res.expensesValue).toBe(50);
    expect(res.expected).toBe(350);
    expect(res.depositedSoFar).toBe(200);
    expect(res.recommendedNow).toBe(150);
  });

  it("clamps negative movement and records warnings for missing prices", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 20 }])
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 50 }]); // more than opening+supplies
    (prisma.supplyOpeningRow.findMany as any).mockResolvedValue([{ itemKey: "beef", qty: 10 }]);
    (prisma.pricebookRow.findMany as any).mockResolvedValue([]); // missing price
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", active: true }]);
    (prisma.attendantExpense.findMany as any).mockResolvedValue([]);
    (prisma.$queryRaw as any).mockResolvedValue([]);

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-03",
      respectAllowlist: false,
    });

    expect(res.salesValue).toBe(0);
    expect(res.recommendedNow).toBe(0);
    expect(res.breakdownByProduct[0].salesUnits).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});


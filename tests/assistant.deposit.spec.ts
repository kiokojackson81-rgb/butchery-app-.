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
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 100, wasteQty: 0 }]) // prev day closings
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 60, wasteQty: 0 }]) // today closings
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 100, wasteQty: 0 }]); // prev-prev day
    (prisma.supplyOpeningRow.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", qty: 0 }]) // today supply
      .mockResolvedValueOnce([]); // prev supply
    (prisma.pricebookRow.findMany as any).mockResolvedValue([{ productKey: "beef", sellPrice: 10, active: true }]);
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", sellPrice: 10, active: true }]);
    (prisma.attendantExpense.findMany as any)
      .mockResolvedValueOnce([]) // today
      .mockResolvedValueOnce([]); // prev
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([]) // today deposits
      .mockResolvedValueOnce([]); // prev deposits

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-01",
      respectAllowlist: false,
    });

    expect(res.ok).toBe(true);
    expect(res.salesValue).toBe(400);
    expect(res.expensesValue).toBe(0);
    expect(res.carryoverPrev).toBe(0);
    expect(res.expected).toBe(400);
    expect(res.recommendedNow).toBe(400);
  });

  it("subtracts expenses and prior deposits", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 80, wasteQty: 10 }])
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 40, wasteQty: 5 }])
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 80, wasteQty: 10 }]);
    (prisma.supplyOpeningRow.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", qty: 0 }])
      .mockResolvedValueOnce([]);
    (prisma.pricebookRow.findMany as any).mockResolvedValue([{ productKey: "beef", sellPrice: 10, active: true }]);
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", sellPrice: 10, active: true }]);
    (prisma.attendantExpense.findMany as any)
      .mockResolvedValueOnce([{ amount: 50 }])
      .mockResolvedValueOnce([]);
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([{ amount: 200, status: "VALID" }])
      .mockResolvedValueOnce([]);

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-02",
      respectAllowlist: false,
    });

    expect(res.salesValue).toBe(450); // opening includes prior waste (80+10) - closing 40 - waste 5
    expect(res.expensesValue).toBe(50);
    expect(res.expected).toBe(400);
    expect(res.depositedSoFar).toBe(200);
    expect(res.recommendedNow).toBe(200);
    expect(res.carryoverPrev).toBe(0);
  });

  it("adds previous outstanding carryover into current recommendation", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 20, wasteQty: 0 }]) // prev closings
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 10, wasteQty: 0 }]) // today closings
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 0, wasteQty: 0 }]); // prev-prev closings (opening for carryover day)
    (prisma.supplyOpeningRow.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", qty: 30 }]) // today supply
      .mockResolvedValueOnce([{ itemKey: "beef", qty: 70 }]); // prev supply
    (prisma.pricebookRow.findMany as any).mockResolvedValue([{ productKey: "beef", sellPrice: 10, active: true }]);
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", sellPrice: 10, active: true }]);
    (prisma.attendantExpense.findMany as any)
      .mockResolvedValueOnce([{ amount: 50 }]) // today expenses
      .mockResolvedValueOnce([{ amount: 0 }]); // prev expenses
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([{ amount: 0, status: "VALID" }]) // today deposits
      .mockResolvedValueOnce([{ amount: 300, status: "VALID" }]); // prev deposits

    const res = await computeAssistantExpectedDeposit({
      code: "AST1",
      outletName: "OutletA",
      date: "2025-01-04",
      respectAllowlist: false,
    });

    // Previous day: opening 0 + supply 70 - closing 20 = 50 units => 500 revenue, minus 0 expenses - 300 deposit = 200 carryover
    expect(res.carryoverPrev).toBe(200);
    // Today: opening (20) + supply 30 - closing 10 = 40 units => 400 sales - 50 expenses = 350 expected
    expect(res.salesValue).toBe(400);
    expect(res.expected).toBe(350);
    expect(res.recommendedNow).toBe(550); // 200 carryover + 350 today
  });

  it("clamps negative movement and records warnings for missing prices", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.attendantClosing.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 20, wasteQty: 0 }])
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 50, wasteQty: 0 }]) // more than opening+supplies
      .mockResolvedValueOnce([{ itemKey: "beef", closingQty: 20, wasteQty: 0 }]);
    (prisma.supplyOpeningRow.findMany as any)
      .mockResolvedValueOnce([{ itemKey: "beef", qty: 10 }])
      .mockResolvedValueOnce([]);
    (prisma.pricebookRow.findMany as any).mockResolvedValue([]); // missing price
    (prisma.product.findMany as any).mockResolvedValue([{ key: "beef", name: "Beef", active: true }]);
    (prisma.attendantExpense.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

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

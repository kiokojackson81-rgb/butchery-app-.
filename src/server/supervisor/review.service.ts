// src/server/supervisor/review.service.ts
import { prisma } from "@/lib/prisma";
import { ZReviewAction } from "./supervisor.validation";
import { notifyOriginator, notifyAttendants, notifySupplier } from "@/server/supervisor/supervisor.notifications";
import { notifySupplyPosted } from "@/server/supply_notify";
import { computeDayTotals } from "@/server/finance";

export async function reviewItem(body: unknown, supervisorCode: string) {
  const { id, action, note } = ZReviewAction.parse(body);

  // Lock the item to avoid double action
  const item = await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.reviewItem.findUnique({ where: { id } });
    if (!current) throw new Error("Item not found");
    if (current.status !== "pending") return current; // already handled
    const updated = await tx.reviewItem.update({
      where: { id },
      data: {
        status: action === "approve" ? "approved" : "rejected",
        payload: { ...(current.payload as any), supervisorNote: note ?? null, decidedBy: supervisorCode, decidedAt: new Date().toISOString() },
      },
    });
    return updated;
  });

  if (item.status !== "pending") {
    await applySideEffects(item, action as any, note);
  }

  return { ok: true, item };
}

async function applySideEffects(item: any, action: "approve" | "reject", note?: string) {
  const type = item.type as string;
  const outlet = item.outlet as string;
  const dateIso = item.date as string;
  const date = dateIso?.slice(0, 10);

  if (action === "reject") {
    await notifyOriginator(item, `❌ Your request was rejected${note ? `: ${note}` : ""}`);
    return;
  }

  // APPROVE cases
  switch (type) {
    case "waste":
      await notifyOriginator(item, "✅ Waste approved");
      break;

    case "expense":
      await notifyOriginator(item, "✅ Expense approved");
      break;

    case "deposit": {
      const ref = (item.payload as any)?.parsed?.ref ?? null;
      await (prisma as any).attendantDeposit.updateMany({
        where: { date, outletName: outlet, note: { contains: ref || "" } },
        data: { status: "VALID" },
      });
      await notifyOriginator(item, "✅ Deposit approved");
      break;
    }

    case "dispute": {
      await notifyOriginator(item, "✅ Dispute acknowledged and noted");
      await notifyAttendants(outlet, `Dispute resolved for ${outlet} (${date}). Check dashboard for details.`);
      break;
    }

  case "supply_edit": {
      const rows = (item.payload as any)?.rows as Array<{ itemKey: string; qty?: number; buyPrice?: number }>;
      if (rows?.length) {
        await (prisma as any).$transaction(async (tx: any) => {
          for (const r of rows) {
            const existing = await tx.supplyOpeningRow.findUnique({
              where: { date_outletName_itemKey: { date, outletName: outlet, itemKey: r.itemKey } as any },
            });
            if (!existing) {
              await tx.supplyOpeningRow.create({
                data: { date, outletName: outlet, itemKey: r.itemKey, qty: r.qty ?? 0, buyPrice: r.buyPrice ?? 0, unit: "kg" },
              });
            } else {
              await tx.supplyOpeningRow.update({
                where: { id: existing.id },
                data: {
                  qty: typeof r.qty === "number" ? r.qty : existing.qty,
                  buyPrice: typeof r.buyPrice === "number" ? r.buyPrice : existing.buyPrice,
                },
              });
            }
          }
        });
      }
      await notifyOriginator(item, "✅ Supply edit approved and applied");
      await notifyAttendants(outlet, `Supply edit applied for ${outlet} (${date}).`);
      // Auto-notify supply summary after supervisor-approved edit
      try { await notifySupplyPosted({ outletName: outlet, date }); } catch {}
      break;
    }

    case "excess":
    case "deficit":
      await notifyOriginator(item, `✅ ${type.toUpperCase()} noted`);
      break;

    default:
      await notifyOriginator(item, "✅ Approved");
  }

  try {
  await computeDayTotals({ date, outletName: outlet });
  } catch {}
}

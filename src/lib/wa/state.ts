import { prisma } from "@/lib/prisma";

type ClosingDraftProduct = {
  productKey: string;
  name: string;
  qty: number;
};

export interface WaClosingDraftState {
  products: Record<string, ClosingDraftProduct>;
  orderedIds: string[];
  selectedProductId?: number;
  lastUpdated: string;
}

export interface WaState {
  waId: string;
  attendantCode?: string;
  outletName?: string;
  role?: "attendant" | "supplier" | "supervisor";
  currentAction?: "menu" | "closing" | "deposit" | "expense" | "summary" | "supply";
  closingDraft?: WaClosingDraftState;
  lastMessageAt?: string;
}

const DEFAULT_STATE: WaState = {
  waId: "",
  currentAction: "menu",
};

function normaliseClosingDraft(draft: WaClosingDraftState): WaClosingDraftState {
  return {
    products: { ...draft.products },
    orderedIds: [...draft.orderedIds],
    selectedProductId: draft.selectedProductId,
    lastUpdated: draft.lastUpdated ?? new Date().toISOString(),
  };
}

export async function getWaState(waId: string): Promise<WaState> {
  const session = await (prisma as any).waSession.findUnique({ where: { phoneE164: waId } }).catch(() => null);
  if (!session) {
    return { ...DEFAULT_STATE, waId };
  }
  const cursor = (session.cursor as any) || {};
  return {
    ...DEFAULT_STATE,
    waId,
    attendantCode: session.code ?? undefined,
    outletName: session.outlet ?? undefined,
    role: session.role ?? undefined,
    currentAction: session.state ?? "menu",
    closingDraft: cursor.closingDraft ?? undefined,
    lastMessageAt: cursor.lastMessageAt ?? undefined,
  };
}

export async function updateWaState(waId: string, patch: Partial<WaState>): Promise<WaState> {
  const session = await (prisma as any).waSession.upsert({
    where: { phoneE164: waId },
    update: {},
    create: { phoneE164: waId, state: "MENU", role: null, cursor: {} },
  });

  const cursor = (session.cursor as any) || {};

  const actionProvided = Object.prototype.hasOwnProperty.call(patch, "currentAction");
  const currentActionFromSession: WaState["currentAction"] = session.state ?? "menu";
  const nextAction = actionProvided
    ? patch.currentAction === null
      ? "menu"
      : patch.currentAction ?? currentActionFromSession
    : currentActionFromSession;

  const draftProvided = Object.prototype.hasOwnProperty.call(patch, "closingDraft");
  let nextDraft: WaClosingDraftState | undefined = cursor.closingDraft;
  if (draftProvided) {
    if (!patch.closingDraft) {
      nextDraft = undefined;
    } else {
      nextDraft = normaliseClosingDraft({
        products: patch.closingDraft.products ?? {},
        orderedIds: patch.closingDraft.orderedIds ?? [],
        selectedProductId: patch.closingDraft.selectedProductId,
        lastUpdated: patch.closingDraft.lastUpdated ?? new Date().toISOString(),
      });
    }
  }

  const nextState: WaState = {
    ...DEFAULT_STATE,
    waId,
    attendantCode: patch.attendantCode ?? (session.code ?? undefined),
    outletName: patch.outletName ?? (session.outlet ?? undefined),
    role: patch.role ?? (session.role ?? undefined),
    currentAction: nextAction,
    closingDraft: nextDraft,
    lastMessageAt: patch.lastMessageAt ?? cursor.lastMessageAt ?? new Date().toISOString(),
  };

  await (prisma as any).waSession.update({
    where: { id: session.id },
    data: {
      state: nextState.currentAction,
      role: nextState.role ?? null,
      outlet: nextState.outletName ?? null,
      cursor: {
        ...cursor,
        closingDraft: nextDraft,
        lastMessageAt: nextState.lastMessageAt,
      },
    },
  });

  return nextState;
}

export async function clearCurrentAction(waId: string): Promise<void> {
  const session = await (prisma as any).waSession.findUnique({ where: { phoneE164: waId } }).catch(() => null);
  if (!session) return;
  const cursor = (session.cursor as any) || {};
  delete cursor.closingDraft;
  await (prisma as any).waSession.update({
    where: { id: session.id },
    data: { state: "MENU", cursor },
  });
}



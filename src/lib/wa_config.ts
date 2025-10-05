// src/lib/wa_config.ts
// Centralized config access for WhatsApp flows, backed by Setting table.
import { prisma } from "@/lib/prisma";

export type AttendantFlowConfig = {
  enableExpense: boolean;
  enableDeposit: boolean;
  enableTxns: boolean;
  enableSupplyView: boolean;
  enableSummary: boolean;
  enableSubmitAndLock: boolean;
  enableWaste: boolean;
};

export type SupplierFlowConfig = {
  enableTransfer: boolean;
  enableRecent: boolean;
  enableDisputes: boolean;
};

export type SupervisorFlowConfig = {
  showReview: boolean;
  showTxns: boolean;
  showLogout: boolean;
};

const DEFAULT_ATTENDANT: AttendantFlowConfig = {
  enableExpense: true,
  enableDeposit: true,
  enableTxns: true,
  enableSupplyView: true,
  enableSummary: true,
  enableSubmitAndLock: true,
  enableWaste: true,
};

const DEFAULT_SUPPLIER: SupplierFlowConfig = {
  enableTransfer: true,
  enableRecent: true,
  enableDisputes: true,
};

const DEFAULT_SUPERVISOR: SupervisorFlowConfig = {
  showReview: true,
  showTxns: true,
  showLogout: true,
};

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key } });
    const val = row?.value;
    if (!val || typeof val !== "object") return fallback;
    return { ...fallback, ...val } as T;
  } catch {
    return fallback;
  }
}

export async function getAttendantConfig(): Promise<AttendantFlowConfig> {
  return readJSON<AttendantFlowConfig>("wa_flow_attendant", DEFAULT_ATTENDANT);
}

export async function getSupplierConfig(): Promise<SupplierFlowConfig> {
  return readJSON<SupplierFlowConfig>("wa_flow_supplier", DEFAULT_SUPPLIER);
}

export async function getSupervisorConfig(): Promise<SupervisorFlowConfig> {
  return readJSON<SupervisorFlowConfig>("wa_flow_supervisor", DEFAULT_SUPERVISOR);
}

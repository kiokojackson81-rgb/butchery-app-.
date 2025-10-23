-- DropForeignKey
ALTER TABLE "public"."ScopeProduct" DROP CONSTRAINT "ScopeProduct_scopeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Attendant" DROP CONSTRAINT "Attendant_outletId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LoginCode" DROP CONSTRAINT "LoginCode_attendantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Session" DROP CONSTRAINT "Session_attendantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Shift" DROP CONSTRAINT "Shift_attendantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ProductAssignment" DROP CONSTRAINT "ProductAssignment_attendantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AttendantKPI" DROP CONSTRAINT "AttendantKPI_attendantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."CommissionConfig" DROP CONSTRAINT "CommissionConfig_attendantId_fkey";

-- DropTable
DROP TABLE "public"."Outlet";

-- DropTable
DROP TABLE "public"."Product";

-- DropTable
DROP TABLE "public"."PersonCode";

-- DropTable
DROP TABLE "public"."AttendantScope";

-- DropTable
DROP TABLE "public"."ScopeProduct";

-- DropTable
DROP TABLE "public"."PricebookRow";

-- DropTable
DROP TABLE "public"."SupplyOpeningRow";

-- DropTable
DROP TABLE "public"."SupplyTransfer";

-- DropTable
DROP TABLE "public"."AttendantClosing";

-- DropTable
DROP TABLE "public"."AttendantDeposit";

-- DropTable
DROP TABLE "public"."Till";

-- DropTable
DROP TABLE "public"."Payment";

-- DropTable
DROP TABLE "public"."AttendantExpense";

-- DropTable
DROP TABLE "public"."AttendantTillCount";

-- DropTable
DROP TABLE "public"."ActivePeriod";

-- DropTable
DROP TABLE "public"."Setting";

-- DropTable
DROP TABLE "public"."AttendantAssignment";

-- DropTable
DROP TABLE "public"."PhoneMapping";

-- DropTable
DROP TABLE "public"."ChatraceSetting";

-- DropTable
DROP TABLE "public"."SupplyRequest";

-- DropTable
DROP TABLE "public"."Attendant";

-- DropTable
DROP TABLE "public"."LoginCode";

-- DropTable
DROP TABLE "public"."Session";

-- DropTable
DROP TABLE "public"."AppState";

-- DropTable
DROP TABLE "public"."ReviewItem";

-- DropTable
DROP TABLE "public"."WaMessageLog";

-- DropTable
DROP TABLE "public"."WaSession";

-- DropTable
DROP TABLE "public"."ReminderSend";

-- DropTable
DROP TABLE "public"."SupervisorCommission";

-- DropTable
DROP TABLE "public"."OutletTargets";

-- DropTable
DROP TABLE "public"."ProductDepositRule";

-- DropTable
DROP TABLE "public"."WasteThreshold";

-- DropTable
DROP TABLE "public"."OutletPerformance";

-- DropTable
DROP TABLE "public"."Shift";

-- DropTable
DROP TABLE "public"."ProductAssignment";

-- DropTable
DROP TABLE "public"."AttendantKPI";

-- DropTable
DROP TABLE "public"."ProductSupplyStat";

-- DropTable
DROP TABLE "public"."SupplyRecommendation";

-- DropTable
DROP TABLE "public"."SupplyIntervalPerformance";

-- DropTable
DROP TABLE "public"."DayClosePeriod";

-- DropTable
DROP TABLE "public"."CommissionConfig";

-- DropEnum
DROP TYPE "public"."OutletCode";

-- DropEnum
DROP TYPE "public"."PaymentStatus";

-- DropEnum
DROP TYPE "public"."PersonRole";

-- DropEnum
DROP TYPE "public"."DepositStatus";

-- DropEnum
DROP TYPE "public"."SalaryFrequency";


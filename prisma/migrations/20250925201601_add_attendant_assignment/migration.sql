-- CreateTable
CREATE TABLE "public"."AttendantAssignment" (
    "code" TEXT NOT NULL,
    "outlet" TEXT NOT NULL,
    "productKeys" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("code")
);

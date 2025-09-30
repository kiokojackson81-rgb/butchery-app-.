import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let logs: any[];
  const hasModel = (prisma as any).waMessageLog && typeof (prisma as any).waMessageLog.findMany === "function";
  if (hasModel) {
    logs = await (prisma as any).waMessageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        waMessageId: true,
        status: true,
        createdAt: true,
        templateName: true,
      },
    });
  } else {
    logs = await (prisma as any).$queryRawUnsafe(
      `SELECT id, "waMessageId", status, "createdAt", "templateName" FROM "WaMessageLog" ORDER BY "createdAt" DESC LIMIT 10`
    );
  }

  console.log("=== Last 10 WhatsApp Message Logs ===");
  for (const log of logs) {
    console.log({
      id: log.id,
      waMessageId: log.waMessageId,
      status: log.status,
      template: log.templateName,
      createdAt: log.createdAt,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(){
  const phone = '+254700000001';
  const role = 'supplier';
  const code = 'SUPTEST';
  const sess = await prisma.waSession.upsert({
    where: { phoneE164: phone },
    update: { role, code, state: 'SPL_MENU', cursor: { date: new Date().toISOString().slice(0,10) } },
    create: { phoneE164: phone, role, code, state: 'SPL_MENU', cursor: { date: new Date().toISOString().slice(0,10) } }
  });
  console.log('session created', sess);
}

main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>process.exit(0));

#!/usr/bin/env node
import { prisma } from '../src/lib/prisma';

async function timeline(phone) {
  const rows = await prisma.waMessageLog.findMany({
    where: { OR: [ { payload: { path: ['phone'], equals: phone } as any }, { payload: { path: ['in_reply_to'], equals: phone } as any } ] },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  for (const r of rows) {
    console.log('---', r.id, r.createdAt.toISOString(), r.status, r.type);
    if (r.payload && r.payload.meta && r.payload.meta.ooc) {
      console.log('  OOC:', JSON.stringify(r.payload.meta.ooc).slice(0, 1000));
    }
    if (r.payload && r.payload.text) {
      console.log('  text:', String(r.payload.text).slice(0, 500));
    }
    console.log('  raw payload preview:', JSON.stringify(r.payload).slice(0, 800));
  }
}

if (process.argv.length < 3) {
  console.error('Usage: node scripts/inspect-wa-timeline.mjs +254700000000');
  process.exit(1);
}

const phone = process.argv[2];
timeline(phone).then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(2)});

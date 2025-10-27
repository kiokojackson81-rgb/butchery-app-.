#!/usr/bin/env node
/*
  Run a set of read-only SQL checks against the database using Prisma.
  Expects DATABASE_URL to be set in the environment (the script will fail fast otherwise).
  Prints JSON results for each query with a label.
*/
import {PrismaClient} from '@prisma/client'

function die(msg){
  console.error(msg)
  process.exit(2)
}

if (!process.env.DATABASE_URL) {
  die('Error: DATABASE_URL is not set in the environment. Please set it and re-run.')
}

const prisma = new PrismaClient()

const queries = [
  {
    name: 'tills_lookup',
    sql: `SELECT "id","outletCode","label","tillNumber","storeNumber","headOfficeNumber","isActive" FROM "Till" WHERE "outletCode" IN ('BARAKA_C','GENERAL');`
  },
  {
    name: 'payments_summary_90d_by_shortcode',
    sql: `SELECT p."businessShortCode", COUNT(*) AS payments_count, SUM(p."amount") AS payments_total, MAX(p."createdAt") AS last_seen FROM "Payment" p WHERE p."createdAt" >= now() - interval '90 days' GROUP BY p."businessShortCode" ORDER BY payments_total DESC LIMIT 200;`
  },
  {
    name: 'payments_for_till_numbers',
    sql: `SELECT p."id", p."status", p."amount", p."businessShortCode", p."storeNumber", p."headOfficeNumber", p."merchantRequestId", p."checkoutRequestId", p."createdAt" FROM "Payment" p WHERE p."businessShortCode" IN ('3574871','3574947') OR p."storeNumber" IN ('3574871','3574947') OR p."headOfficeNumber" IN ('3574871','3574947') ORDER BY p."createdAt" DESC LIMIT 200;`
  },
  {
    name: 'attendant_deposits_recent_90d',
    sql: `SELECT d."id", d."status", d."amount", d."outletName", d."code", d."createdAt" FROM "AttendantDeposit" d WHERE d."createdAt" >= now() - interval '90 days' ORDER BY d."createdAt" DESC LIMIT 200;`
  },
  {
    name: 'deposit_recon_totals_90d_by_outlet',
    sql: `SELECT d."outletName", COUNT(*) AS deposit_count, SUM(d."amount") AS deposit_total FROM "AttendantDeposit" d WHERE d."status" = 'VALID' AND d."createdAt" >= now() - interval '90 days' GROUP BY d."outletName" ORDER BY deposit_total DESC LIMIT 200;`
  },
  {
    name: 'payments_without_matched_till_365d',
    sql: `SELECT p."id", p."businessShortCode", p."storeNumber", p."headOfficeNumber", p."amount", p."status", p."createdAt" FROM "Payment" p LEFT JOIN "Till" t ON p."businessShortCode" = t."tillNumber" WHERE t."id" IS NULL AND p."createdAt" >= now() - interval '365 days' LIMIT 500;`
  },
  {
    name: 'stk_related_recent',
    sql: `SELECT p."id", p."merchantRequestId", p."checkoutRequestId", p."status", p."amount", p."businessShortCode", p."storeNumber", p."headOfficeNumber", p."createdAt" FROM "Payment" p WHERE p."merchantRequestId" IS NOT NULL OR p."checkoutRequestId" IS NOT NULL ORDER BY p."createdAt" DESC LIMIT 200;`
  }
]

async function run(){
  try{
    console.log(JSON.stringify({ok:true, note: 'Starting readonly checks', timestamp: new Date().toISOString()}))

    for (const q of queries){
      try{
        console.error(`Running: ${q.name}`)
        const rows = await prisma.$queryRawUnsafe(q.sql)
        console.log(JSON.stringify({query: q.name, rowCount: Array.isArray(rows)?rows.length:0, rows}))
      }catch(qe){
        console.error(JSON.stringify({query: q.name, ok:false, error: String(qe)}))
      }
    }

    await prisma.$disconnect()
    console.error('Done')
  }catch(e){
    console.error('Fatal error running queries:', e)
    try{ await prisma.$disconnect() }catch(_){}
    process.exit(1)
  }
}

run()

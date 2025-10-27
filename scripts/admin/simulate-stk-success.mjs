#!/usr/bin/env node
import { PrismaClient } from '@prisma/client'

function randId(){ return Math.random().toString(36).slice(2,10).toUpperCase() }

async function die(msg){ console.error(msg); process.exit(1) }

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Please set it to run this simulation.')
  process.exit(2)
}

const prisma = new PrismaClient()

async function run(){
  try{
    // Lookup BARAKA_C till
    const till = await prisma.till.findFirst({ where: { outletCode: 'BARAKA_C', isActive: true } })
    if (!till) return die('No active Till found for BARAKA_C')

    const storeShortcode = till.storeNumber
    const headOfficeShortcode = till.headOfficeNumber

    console.error('Using Till:', { outletCode: till.outletCode, tillNumber: till.tillNumber, storeShortcode, headOfficeShortcode })

    // Debug: list payment-related columns
    try{
      const cols = await prisma.$queryRawUnsafe(`SELECT table_name,column_name FROM information_schema.columns WHERE table_name ILIKE '%payment%'`)
      console.error('payment-related columns:', JSON.stringify(cols))
    }catch(e){ console.error('Failed to list information_schema columns:', String(e)) }

    // Create PENDING payment using raw SQL (DB has lowercase column names like 'partyb')
    const id = `sim-${randId()}`
    const mrid = `SIM-MR-${randId()}`
    const crid = `SIM-CR-${randId()}`
    const receipt = `SIMR-${randId()}`
    const rawPayload = JSON.stringify({ simulated: true })

  const insertSql = `INSERT INTO "Payment" ("id","outletCode","amount","msisdn","status","businessShortCode","storeNumber","headOfficeNumber","accountReference","description","merchantRequestId","checkoutRequestId","rawPayload","createdAt","updatedAt") VALUES ($1,$2::\"OutletCode\",$3,$4,$5::\"PaymentStatus\",$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())`
  await prisma.$executeRawUnsafe(insertSql, id, 'BARAKA_C', 10, '254700000000', 'PENDING', storeShortcode, storeShortcode, headOfficeShortcode, 'SIM', 'Simulated Ksh10 deposit', mrid, crid, rawPayload)
    console.log(JSON.stringify({ created: { id, outletCode: 'BARAKA_C', amount: 10, merchantRequestId: mrid, checkoutRequestId: crid } }))

    // Update to SUCCESS (raw SQL)
  const updateSql = `UPDATE "Payment" SET "status" = $1::\"PaymentStatus\", "mpesaReceipt" = $2, "rawPayload" = $3::jsonb, "updatedAt" = now() WHERE "id" = $4`
  await prisma.$executeRawUnsafe(updateSql, 'SUCCESS', receipt, rawPayload, id)
    const updated = await prisma.$queryRawUnsafe('SELECT * FROM "Payment" WHERE "id" = $1', id)
    console.log(JSON.stringify({ updated }))

    // Optional: trigger Pusher channel if env present
    if (process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
      try{
        const Pusher = require('pusher')
        const p = new Pusher({ appId: process.env.PUSHER_APP_ID, key: process.env.PUSHER_KEY, secret: process.env.PUSHER_SECRET, cluster: process.env.PUSHER_CLUSTER, useTLS: true })
        const payload = { outletCode: updated.outletCode, amount: updated.amount, msisdnMasked: '***000', receipt: updated.mpesaReceipt, date: String(updated.updatedAt) }
        await p.trigger(`outlet-${updated.outletCode}`, 'deposit_confirmed', payload)
        console.log(JSON.stringify({ emitted: true, payload }))
      }catch(e){ console.error('Pusher emit failed:', String(e)) }
    } else {
      console.error('PUSHER env not set — skipping real-time emit (dashboard will show on refresh)')
    }

    await prisma.$disconnect()
    process.exit(0)
  }catch(e){
    console.error('Simulation failed:', String(e))
    try{ await prisma.$disconnect() }catch(_){ }
    process.exit(1)
  }
}

run()

#!/usr/bin/env node
// scripts/send-midnight-payments.js
// Run at local midnight (APP_TZ). Requires DATABASE_URL and WHATSAPP envs.
const { computeDayTotals } = require('../src/server/finance');
const { sendMidnightSummary } = require('../src/lib/wa_notifications');
const { prisma } = require('../src/lib/prisma');

(async ()=>{
  const date = process.argv[2] || new Date().toISOString().slice(0,10);
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s=>s.trim()).filter(Boolean);
  const barakaASupervisor = process.env.SUPERVISOR_BARAKA_A || '+254758220123';
  const kyaloPhone = process.env.KYALO_PHONE || null;

  // Send overall summary to admin
  try {
    // Compute for all outlets: iterate outlets
    const outlets = await (prisma as any).outlet.findMany();
    let totalPayments = 0; let totalAmount = 0; let topPayersArr = [];
    for (const o of outlets) {
      const stats = await computeDayTotals({ date, outletName: o.name });
      const paymentsCount = stats ? (stats.tillSalesGross ? 1 : 0) : 0; // lightweight
      totalPayments += paymentsCount;
      totalAmount += Math.round(stats.tillSalesGross || 0);
      // build a tiny topPayers sample
      topPayersArr.push(`${o.name}:${Math.round(stats.tillSalesGross||0)}`);
      // If Baraka A, send to supervisor and kyalo
      if (o.name === 'Baraka A') {
        await sendMidnightSummary({ to: barakaASupervisor, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
        if (kyaloPhone) await sendMidnightSummary({ to: kyaloPhone, outlet: 'Baraka A', date, count: paymentsCount, total: Math.round(stats.tillSalesGross||0), topPayers: '' });
      }
    }
    const topPayers = topPayersArr.slice(0,5).join(', ');
    for (const admin of adminPhones) {
      await sendMidnightSummary({ to: admin, outlet: 'All outlets', date, count: totalPayments, total: totalAmount, topPayers });
    }
    console.log('Midnight summaries sent');
  } catch (e) { console.error('Midnight run failed', e); process.exit(2); }
})();

#!/usr/bin/env node
// scripts/notify-high-value.js
// Usage: node scripts/notify-high-value.js <phone> <outlet> <amount> <payer> <time> <till> <ref>
const { sendHighValueAlert } = require('../src/lib/wa_notifications');

const [,, phone, outlet, amount, payer, time, till, ref] = process.argv;
if (!phone || !outlet || !amount) {
  console.error('Usage: node scripts/notify-high-value.js <phone> <outlet> <amount> <payer> <time> <till> <ref>');
  process.exit(2);
}
(async ()=>{
  try {
    await sendHighValueAlert({ to: phone, outlet, amount: Number(amount), payer: payer || 'Unknown', time: time || new Date().toISOString(), till: till || '', ref: ref || '' });
    console.log('Notified', phone);
  } catch (e) { console.error(e); process.exit(3); }
})();

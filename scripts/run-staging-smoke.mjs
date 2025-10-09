#!/usr/bin/env node
// Staging smoke-run helper
// Usage: node run-staging-smoke.mjs --base https://staging.example.com --phone +254605663175
// Requires env: WHATSAPP_TOKEN, WHATSAPP_WABA_ID, OPENAI_API_KEY, WA_TEMPLATE_NAME, WEBHOOK_VERIFY_TOKEN
import fetch from 'node-fetch';
import process from 'process';
import fs from 'fs';
import path from 'path';

// For smoke-run we want to enable interactive sends and autosend behavior so the
// test exercises real interactive payload paths. Also disable the warm-up
// template to avoid noisy hello_world template errors during the run.
process.env.WA_INTERACTIVE_ENABLED = process.env.WA_INTERACTIVE_ENABLED || 'true';
process.env.WA_AUTOSEND_ENABLED = process.env.WA_AUTOSEND_ENABLED || 'true';
process.env.WHATSAPP_WARMUP_TEMPLATE = process.env.WHATSAPP_WARMUP_TEMPLATE || 'none';

function usage() {
  console.log('Usage: node run-staging-smoke.mjs --base <baseUrl> --phone <E164> [--diag-key <key>]');
  process.exit(1);
}

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const phoneIdx = argv.indexOf('--phone');
const diagKeyIdx = argv.indexOf('--diag-key');
if (baseIdx < 0 || phoneIdx < 0) usage();
const base = argv[baseIdx + 1];
const phone = argv[phoneIdx + 1];
const diagKey = diagKeyIdx >= 0 ? argv[diagKeyIdx + 1] : undefined;
if (!base || !phone) usage();

const DIAG = `${base.replace(/\/$/, '')}/api/wa/diag`;
const WEBHOOK = `${base.replace(/\/$/, '')}/api/wa/webhook`;

async function postWebhook(payload) {
  try {
    const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

async function getDiag(phoneQuery) {
  try {
    const url = new URL(DIAG);
    if (phoneQuery) url.searchParams.set('phone', phoneQuery);
    if (diagKey) url.searchParams.set('key', diagKey);
    const r = await fetch(url.toString());
    try { return await r.json(); } catch { return null; }
  } catch (e) { return null; }
}

function makeInboundText(phoneE164, text, id = `wamid.${Date.now()}`) {
  const from = phoneE164.replace(/^\+/, '');
  return { entry: [{ changes: [{ value: { messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] };
}

function makeInboundInteractiveSelect(phoneE164, id, title) {
  const from = phoneE164.replace(/^\+/, '');
  return { entry: [{ changes: [{ value: { messages: [{ id: `wamid.${Date.now()}`, from, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } }] } }] }] };
}

async function saveArtifact(dir, name, obj) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('failed to save artifact', e);
  }
}

const ART_ROOT = path.join(process.cwd(), '.smoke-artifacts');

async function runOne(name, fn) {
  const tdir = path.join(ART_ROOT, `${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_')}`);
  console.log('\n--- RUN:', name, '---');
  try {
    const res = await fn();
    await saveArtifact(tdir, 'result', res || {});
    return { ok: true, res };
  } catch (e) {
    await saveArtifact(tdir, 'error', { message: String(e), stack: e?.stack });
    return { ok: false, error: e };
  }
}

async function run() {
  console.log('Running staging smoke-run against', base);
  console.log('Using phone', phone);

  // Test matrix (A-F) — each step posts webhook payloads and polls diag
  // A1 — Unmapped phone -> login prompt
  await runOne('A1_unmapped_login_prompt', async () => {
    const p = makeInboundText(phone, 'hi');
    const r = await postWebhook(p);
    await sleep(1500);
    const d = await getDiag(phone);
    return { webhook: r, diag: d, payload: p };
  });

  // A2 — Authenticated welcome/menu (assumes phone is mapped in staging)
  await runOne('A2_authenticated_welcome', async () => {
    const p = makeInboundText(phone, 'hi', `wamid.${Date.now()+1}`);
    const r = await postWebhook(p);
    await sleep(1500);
    const d = await getDiag(phone);
    return { webhook: r, diag: d, payload: p };
  });

  // B1 — Silence guard (unsupported media)
  await runOne('B1_silence_guard', async () => {
    const sticker = { entry: [{ changes: [{ value: { messages: [{ id: `wamid.${Date.now()+2}`, from: phone.replace(/^\+/, ''), type: 'sticker', sticker: { id: 's1' } }] } }] }] };
    const r = await postWebhook(sticker);
    await sleep(1500);
    const d = await getDiag(phone);
    return { webhook: r, diag: d, payload: sticker };
  });

  // B2 — OOC presence
  await runOne('B2_ooc_presence', async () => {
    const p = makeInboundText(phone, 'hi', `wamid.${Date.now()+3}`);
    const r = await postWebhook(p);
    await sleep(2000);
    const d = await getDiag(phone);
    return { webhook: r, diag: d, payload: p };
  });

  // C1 — Attendant closing single line (simulate enter closing -> select product -> quantity)
  await runOne('C1_closing_single_line', async () => {
    // Sequence: open closing, select product (simulate selection), send quantity
    const s1 = await postWebhook(makeInboundInteractiveSelect(phone, 'ATT_CLOSING', 'Enter Closing'));
    await sleep(800);
    const s2 = await postWebhook(makeInboundInteractiveSelect(phone, 'PRODUCT_BEEF', 'Beef 20kg'));
    await sleep(800);
    const s3 = await postWebhook(makeInboundText(phone, '20', `wamid.${Date.now()+10}`));
    await sleep(1500);
    const d = await getDiag(phone);
    return { steps: [s1, s2, s3], diag: d };
  });

  // C2 — Deposit parse (MPESA SMS sample -> confirm)
  await runOne('C2_deposit_parse', async () => {
    const mpesa = 'Ksh 3,500.00 confirmed. QWERTY1234Z';
    const s1 = await postWebhook(makeInboundText(phone, mpesa, `wamid.${Date.now()+20}`));
    await sleep(1500);
    // Confirm action (simulate pressing confirm button)
    const s2 = await postWebhook(makeInboundInteractiveSelect(phone, 'ATT_DEPOSIT_CONFIRM', 'Confirm'));
    await sleep(2000);
    const d = await getDiag(phone);
    return { steps: [s1, s2], diag: d };
  });

  // C3 — Expense create
  await runOne('C3_expense_create', async () => {
    const s1 = await postWebhook(makeInboundInteractiveSelect(phone, 'ATT_EXPENSE', 'Expense'));
    await sleep(800);
    const s2 = await postWebhook(makeInboundText(phone, 'Fuel 300', `wamid.${Date.now()+30}`));
    await sleep(1500);
    const d = await getDiag(phone);
    return { steps: [s1, s2], diag: d };
  });

  // D1 — Supplier new delivery (assumes phone belongs to supplier role in staging)
  await runOne('D1_supplier_new_delivery', async () => {
    const supPhone = phone; // user-provided phone should be supplier in staging for this test
    const s1 = await postWebhook(makeInboundInteractiveSelect(supPhone, 'SUPL_DELIVERY', 'Submit Delivery'));
    await sleep(800);
    // Add two items by text (or button flow depending on GPT prompts)
    const s2 = await postWebhook(makeInboundText(supPhone, 'Beef 20kg @ 520; Goat 10kg @ 600', `wamid.${Date.now()+40}`));
    await sleep(2000);
    const d = await getDiag(supPhone);
    return { steps: [s1, s2], diag: d };
  });

  // D2 — Attendant confirms delivery (simulate attendant phone different from supplier)
  const attendantPhone = phone; // using same phone unless staging has different test numbers
  await runOne('D2_attendant_confirms', async () => {
    const s1 = await postWebhook(makeInboundInteractiveSelect(attendantPhone, 'SUPL_VIEW_OPENING', 'View Opening'));
    await sleep(800);
    const s2 = await postWebhook(makeInboundInteractiveSelect(attendantPhone, 'SUPL_DELIVERY_CONFIRM', 'Confirm Receipt'));
    await sleep(1500);
    const d = await getDiag(attendantPhone);
    return { steps: [s1, s2], diag: d };
  });

  // E1 — Supervisor approves deposit
  await runOne('E1_supervisor_approve_deposit', async () => {
    const supPhone = phone; // must be supervisor in staging for this test
    const s1 = await postWebhook(makeInboundInteractiveSelect(supPhone, 'SV_REVIEW_DEPOSITS', 'Review Deposits'));
    await sleep(800);
    const s2 = await postWebhook(makeInboundInteractiveSelect(supPhone, 'SV_APPROVE_UNLOCK', 'Approve'));
    await sleep(1500);
    const d = await getDiag(supPhone);
    return { steps: [s1, s2], diag: d };
  });

  // E2 — Supervisor adjust closing line
  await runOne('E2_supervisor_adjust_closing', async () => {
    const supPhone = phone;
    const s1 = await postWebhook(makeInboundInteractiveSelect(supPhone, 'SV_REVIEW_CLOSINGS', 'Review Closings'));
    await sleep(800);
    const s2 = await postWebhook(makeInboundText(supPhone, 'Adjust closing for Beef: new 18 reason: spoilage', `wamid.${Date.now()+60}`));
    await sleep(1500);
    const d = await getDiag(supPhone);
    return { steps: [s1, s2], diag: d };
  });

  // F1 — 24h reopen template (simulate closed window by toggling a special test marker)
  await runOne('F1_24h_reopen_template', async () => {
    // This requires staging to have a debug flag; we trigger by posting a special test payload
    const p = makeInboundText(phone, '__TEST_REOPEN__', `wamid.${Date.now()+70}`);
    const r = await postWebhook(p);
    await sleep(2000);
    const d = await getDiag(phone);
    return { webhook: r, diag: d, payload: p };
  });

  console.log('\nFull smoke-run complete. Artifacts written to', ART_ROOT);
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

run().catch((e) => { console.error('Error during smoke-run', e); process.exit(1); });

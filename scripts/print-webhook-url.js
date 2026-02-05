// scripts/print-webhook-url.js
// Prints the webhook verification URL you can use to test GET challenge.
const url = process.argv[2] || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const verifyToken = process.argv[3] || process.env.WHATSAPP_VERIFY_TOKEN || 'barakaops_wa_verify_9fK3pQm2xT7vL8nR';
const challenge = process.argv[4] || 'CHALLENGE_SAMPLE';
console.log(`${url.replace(/\/$/, '')}/api/wa/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(challenge)}`);

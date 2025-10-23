export function ensureDarajaEnv() {
  const required = ['DARAJA_BASE_URL','DARAJA_CONSUMER_KEY','DARAJA_CONSUMER_SECRET','PUBLIC_BASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    // Do not print secrets; only keys missing
    throw new Error(`Missing required env keys: ${missing.join(', ')}`);
  }
}

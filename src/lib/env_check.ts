export function ensureDarajaEnv() {
  // Require the core Daraja envs so prestart-check can validate deployments.
  const required = ['DARAJA_BASE_URL','DARAJA_CONSUMER_KEY','DARAJA_CONSUMER_SECRET','DARAJA_C2B_SHORTCODE','PUBLIC_BASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    // Do not print secrets; only keys missing
    throw new Error(`Missing required env keys: ${missing.join(', ')}`);
  }
}

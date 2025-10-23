function redactMsisdn(msisdn?: string) {
  if (!msisdn) return '';
  // keep only last 3 digits
  const s = String(msisdn);
  const last3 = s.slice(-3);
  return `***${last3}`;
}

function scrub(obj: any) {
  try {
    const s = JSON.stringify(obj);
    // naive redact of obvious tokens
    return s.replace(/([A-Za-z0-9_]*passkey[A-Za-z0-9_]*\s*[:=]\s*")([^"]+)(")/ig, '$1***$3');
  } catch {
    return obj;
  }
}

export function info(payload: any) {
  const out = { ts: new Date().toISOString(), level: 'info', ...payload } as any;
  if (out.msisdn) out.msisdn = redactMsisdn(out.msisdn);
  if (out.raw) out.raw = scrub(out.raw);
  console.info(JSON.stringify(out));
}

export function error(payload: any) {
  const out = { ts: new Date().toISOString(), level: 'error', ...payload } as any;
  if (out.msisdn) out.msisdn = redactMsisdn(out.msisdn);
  if (out.raw) out.raw = scrub(out.raw);
  console.error(JSON.stringify(out));
}

export default { info, error };

import { ensureDarajaEnv } from '@/lib/env_check';

try {
  ensureDarajaEnv();
  console.log('[prestart] Daraja env OK');
  process.exit(0);
} catch (e:any) {
  console.error('[prestart] missing env', e.message);
  process.exit(1);
}

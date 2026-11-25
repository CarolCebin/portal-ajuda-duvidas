import { loadLocalEnvironment } from './env-local.mjs';

try { loadLocalEnvironment(); }
catch { console.error('Não foi possível carregar o arquivo .env.local.'); process.exitCode = 1; }
for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
  const exists = Object.hasOwn(process.env, name);
  const filled = !!process.env[name]?.trim();
  console.log(`${name}: existe=${exists ? 'sim' : 'não'}; preenchida=${filled ? 'sim' : 'não'}`);
}

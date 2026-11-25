import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));

export function loadLocalEnvironment() {
  if (!existsSync(envFile)) throw new Error('Arquivo .env.local não encontrado.');
  loadEnvFile(envFile);
}

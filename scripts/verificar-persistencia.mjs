import { loadLocalEnvironment } from './env-local.mjs';
import { getSupabaseConfig } from '../lib/server/content-store.mjs';
import { verificationSignature } from '../lib/server/verification-auth.mjs';

try {
  loadLocalEnvironment();
  const config = getSupabaseConfig();
  const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error();
  const timestamp = String(Date.now());
  const response = await fetch(new URL('/api/verificacao/persistencia', base), {
    method: 'POST', redirect: 'error',
    headers: { 'x-verificacao-tempo': timestamp, 'x-verificacao-assinatura': verificationSignature(config.secretKey, timestamp) },
  });
  if (response.status === 404) {
    console.error('Verificação indisponível. Abra o app com npm run dev e confira se ele usa o mesmo .env.local.');
    process.exitCode = 1;
  } else {
    const result = await response.json();
    if (response.ok && ['gravacao', 'leitura', 'camposIguais', 'novaLeitura', 'exclusao'].every(key => result[key] === true)) {
      console.log('Verificação aprovada: item gravado pelo servidor do app, campos iguais, nova leitura confirmada e item excluído.');
    } else {
      const stages = ['gravar categoria', 'gravar tópico', 'comparar todos os campos gravados', 'ler pelo app e repetir a leitura sem cache', 'confirmar exclusão'];
      console.error(`Verificação falhou na etapa: ${stages.includes(result.etapa) ? result.etapa : 'acesso ao app'}.`);
      console.error(`Exclusão dos registros de teste confirmada: ${result.limpezaConfirmada === true ? 'sim' : 'não'}.`);
      process.exitCode = 1;
    }
  }
} catch {
  console.error('Não foi possível executar a verificação. Confira os campos do .env.local, o endereço local e se o app está aberto.');
  process.exitCode = 1;
}

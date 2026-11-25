import { createHmac, timingSafeEqual } from 'node:crypto';

export function verificationSignature(secret, timestamp) {
  return createHmac('sha256', secret).update(`central-ajuda:verificacao:${timestamp}`).digest('hex');
}

export function allowVerification(request, env = process.env, now = Date.now()) {
  // A verificação não existe na versão de produção e não recebe dados arbitrários.
  if (env.NODE_ENV !== 'development' || !env.SUPABASE_SECRET_KEY?.trim().startsWith('sb_secret_')) return false;
  const host = new URL(request.url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || request.headers.has('origin')) return false;
  const timestamp = request.headers.get('x-verificacao-tempo') || '';
  const signature = request.headers.get('x-verificacao-assinatura') || '';
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = verificationSignature(env.SUPABASE_SECRET_KEY.trim(), timestamp);
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

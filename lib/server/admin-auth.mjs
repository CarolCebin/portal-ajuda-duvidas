import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseConfig } from './content-store.mjs';

export const ADMIN_COOKIE = 'central_ajuda_admin';
export const ADMIN_PROOF_COOKIE = 'central_ajuda_admin_prova';

export class AdminRequestError extends Error {
  constructor(status) {
    super('Falha no serviço de administração.');
    this.status = status;
  }
}

export async function supabaseAdminRequest(path, { token, service = false, method = 'GET', body, headers = {} } = {}) {
  const config = getSupabaseConfig();
  const response = await fetch(config.url + path, {
    method,
    headers: {
      apikey: service ? config.secretKey : config.publishableKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AdminRequestError(response.status);
  return response;
}

export async function readAdmin(cookies) {
  const token = cookies.get(ADMIN_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const user = await (await supabaseAdminRequest('/auth/v1/user', { token })).json();
    if (!user.id || !user.email_confirmed_at) return null;
    const url = '/rest/v1/avaliacao_admin?select=usuario_id&administradora=eq.true';
    const rows = await (await supabaseAdminRequest(url, { token })).json();
    return rows.some(row => row.usuario_id === user.id) ? { id: user.id, token } : null;
  } catch (error) {
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
}

export function mutationOrigin(request) {
  const value = request.headers.get('origin');
  if (!value || request.headers.get('sec-fetch-site') === 'cross-site') return null;
  try {
    const url = new URL(value);
    const host = request.headers.get('host') || request.nextUrl.host;
    if (['https:', 'http:'].includes(url.protocol) && url.host === host) return url.origin;
  } catch {}
  return null;
}

export function adminResponse(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function adminCookieOptions(origin, maxAge) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(origin).protocol === 'https:',
    maxAge,
  };
}

export async function requestAccessLink(origin) {
  const marker = '/rest/v1/avaliacao_admin?select=usuario_id&administradora=eq.true';
  const [admin] = await (await supabaseAdminRequest(marker, { service: true })).json();
  if (!admin?.usuario_id) throw new AdminRequestError(503);

  const userPath = '/auth/v1/admin/users/' + encodeURIComponent(admin.usuario_id);
  const user = await (await supabaseAdminRequest(userPath, { service: true })).json();
  if (!user.email || user.id !== admin.usuario_id) throw new AdminRequestError(503);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const callback = new URL('/admin/confirmar', origin);
  await supabaseAdminRequest('/auth/v1/otp?redirect_to=' + encodeURIComponent(callback.href), {
    method: 'POST',
    body: { email: user.email, create_user: false, code_challenge: challenge, code_challenge_method: 's256' },
  });
  return verifier;
}

export async function confirmAccessLink(code, verifier) {
  const session = await (await supabaseAdminRequest('/auth/v1/token?grant_type=pkce', {
    method: 'POST',
    body: { auth_code: code, code_verifier: verifier },
  })).json();
  if (typeof session.access_token !== 'string' || !Number.isFinite(session.expires_in)) return null;
  const admin = await readAdmin({ get: () => ({ value: session.access_token }) });
  return admin ? { token: session.access_token, expires: session.expires_in } : null;
}

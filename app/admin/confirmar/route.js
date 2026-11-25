import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_PROOF_COOKIE, adminCookieOptions, confirmAccessLink } from '../../../lib/server/admin-auth.mjs';

export async function GET(request) {
  const destination = new URL('/admin', request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get('code');
  const verifier = request.cookies.get(ADMIN_PROOF_COOKIE)?.value;
  let session = null;
  if (code && /^[A-Za-z0-9_-]{43}$/.test(verifier || '')) {
    try { session = await confirmAccessLink(code, verifier); } catch {}
  }
  if (!session) destination.searchParams.set('link', 'invalido');
  // O caminho relativo preserva o domínio usado pela pessoa atrás de um proxy.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: destination.pathname + destination.search, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
  if (session) {
    response.cookies.set(ADMIN_COOKIE, session.token, adminCookieOptions(request.nextUrl.origin, session.expires));
    response.cookies.delete(ADMIN_PROOF_COOKIE);
  }
  return response;
}

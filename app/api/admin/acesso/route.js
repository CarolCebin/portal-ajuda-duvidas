import { NextResponse } from 'next/server';
import {
  ADMIN_PROOF_COOKIE, adminCookieOptions, adminResponse, mutationOrigin, requestAccessLink,
} from '../../../../lib/server/admin-auth.mjs';

export async function POST(request) {
  const origin = mutationOrigin(request);
  if (!origin) return adminResponse({ erro: 'Solicitação não permitida.' }, 403);

  try {
    const verifier = await requestAccessLink(origin);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(ADMIN_PROOF_COOKIE, verifier, adminCookieOptions(origin, 3600));
    return response;
  } catch (error) {
    if (error.status === 429) {
      return adminResponse({ erro: 'Aguarde um minuto antes de solicitar outro link.' }, 429);
    }
    return adminResponse({ erro: 'O envio do link está indisponível. Tente novamente mais tarde.' }, 503);
  }
}

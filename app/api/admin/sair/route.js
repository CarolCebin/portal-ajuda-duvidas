import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_PROOF_COOKIE, adminResponse, mutationOrigin, supabaseAdminRequest } from '../../../../lib/server/admin-auth.mjs';

export async function POST(request) {
  if (!mutationOrigin(request)) return adminResponse({ erro: 'Solicitação não permitida.' }, 403);
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (token) {
    try { await supabaseAdminRequest('/auth/v1/logout?scope=local', { method: 'POST', token }); } catch {}
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  response.cookies.delete(ADMIN_COOKIE);
  response.cookies.delete(ADMIN_PROOF_COOKIE);
  return response;
}

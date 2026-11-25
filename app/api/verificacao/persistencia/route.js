import { contentStore } from '../../../../lib/server/content-service.js';
import { allowVerification } from '../../../../lib/server/verification-auth.mjs';
import { verifyPersistence, PersistenceCheckError } from '../../../../lib/server/persistence-check.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let running = false;

export async function POST(request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!allowVerification(request)) return new Response(null, { status: 404, headers });
  if (running) return Response.json({ error: 'Já existe uma verificação em andamento.' }, { status: 409, headers });
  running = true;
  try {
    const contentUrl = new URL('/api/conteudo', request.url);
    const result = await verifyPersistence(contentStore, async () => {
      const response = await fetch(contentUrl, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Leitura indisponível.');
      return response.json();
    });
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({
      error: 'A verificação não passou.',
      etapa: error instanceof PersistenceCheckError ? error.stage : 'verificação',
      limpezaConfirmada: error instanceof PersistenceCheckError && error.cleanupOk,
    }, { status: 500, headers });
  } finally { running = false; }
}

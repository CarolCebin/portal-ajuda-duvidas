import { contentStore } from '../../../lib/server/content-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
  try {
    return Response.json(await contentStore.readContent(), { headers });
  } catch {
    return Response.json({ error: 'Não foi possível carregar o conteúdo. Tente novamente mais tarde.' }, { status: 503, headers });
  }
}

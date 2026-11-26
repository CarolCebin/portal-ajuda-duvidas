import { parseCostSettings } from '../../../../lib/custos.mjs';
import { adminResponse, mutationOrigin, readAdmin, supabaseAdminRequest } from '../../../../lib/server/admin-auth.mjs';

export const runtime = 'nodejs';

const denied = () => adminResponse({ erro: 'Acesso negado.' }, 403);
const unavailable = () => adminResponse({ erro: 'Não foi possível acessar os custos. Tente novamente.' }, 503);

async function summary() {
  const response = await supabaseAdminRequest('/rest/v1/rpc/ia_resumo_custos', {
    service: true, method: 'POST', body: {},
  });
  return response.json();
}

export async function GET(request) {
  try {
    if (!await readAdmin(request.cookies)) return denied();
    return adminResponse(await summary());
  } catch {
    return unavailable();
  }
}

export async function POST(request) {
  if (!mutationOrigin(request)) return denied();
  try {
    if (!await readAdmin(request.cookies)) return denied();
    const input = await request.json().catch(() => null);
    const settings = parseCostSettings(input);
    if (!settings) return adminResponse({ erro: 'Confira os preços, a cotação e o limite diário antes de salvar.' }, 400);
    const response = await supabaseAdminRequest('/rest/v1/ia_configuracao_custos?unica=eq.true', {
      service: true, method: 'PATCH', body: settings, headers: { Prefer: 'return=representation' },
    });
    const [saved] = await response.json();
    if (!saved) return unavailable();
    const { unica, ...configuracao } = saved;
    return adminResponse({ configuracao });
  } catch {
    return unavailable();
  }
}

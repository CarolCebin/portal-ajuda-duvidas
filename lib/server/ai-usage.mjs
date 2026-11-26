import { randomUUID } from 'node:crypto';
import { supabaseAdminRequest } from './admin-auth.mjs';

async function reserveCall({ id, model, origin, browserHash }) {
  const response = await supabaseAdminRequest('/rest/v1/rpc/ia_reservar_chamada', {
    service: true, method: 'POST',
    body: { p_id: id, p_origem: origin, p_modelo: model, p_navegador_hash: browserHash ?? null },
  });
  return response.json();
}

async function finishCall(id, metrics) {
  const path = '/rest/v1/ia_chamadas?id=eq.' + id + '&estado=eq.pendente';
  await supabaseAdminRequest(path, { service: true, method: 'PATCH', body: metrics });
}

function tokenCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function tokensFromResponse(metadata) {
  const input = tokenCount(metadata?.promptTokenCount);
  const candidate = tokenCount(metadata?.candidatesTokenCount);
  const thoughts = tokenCount(metadata?.thoughtsTokenCount);
  // Gemini omite contagens de saída iguais a zero; sem metadados úteis, mantenha null.
  const known = input !== null || candidate !== null || thoughts !== null;
  return { tokens_entrada: input, tokens_saida: known ? (candidate ?? 0) + (thoughts ?? 0) : null };
}

export async function meterModelCall({ model, origin, browserHash, generate }, {
  reserve = reserveCall,
  finish = finishCall,
  clock = () => performance.now(),
} = {}) {
  const id = randomUUID();
  let reserved;
  try {
    reserved = await reserve({ id, model, origin, browserHash });
  } catch {
    throw new Error('MEDICAO_IA_INDISPONIVEL');
  }
  if (reserved === false) throw new Error('LIMITE_DIARIO_IA');
  if (reserved !== true) throw new Error('MEDICAO_IA_INDISPONIVEL');

  const start = clock();
  let response;
  let providerError;
  try {
    response = await generate();
  } catch (error) {
    providerError = error;
  }
  const metrics = {
    estado: providerError ? 'falhou' : 'respondida',
    duracao_ms: Math.max(0, Math.round(clock() - start)),
    ...tokensFromResponse(response?.usageMetadata),
  };
  try {
    await finish(id, metrics);
  } catch {
    try { await finish(id, metrics); } catch {
      console.warn('ia_medicao_incompleta', { chamada: id });
      throw new Error('MEDICAO_IA_INDISPONIVEL');
    }
  }
  if (providerError) throw providerError;
  return response;
}

export const EVALUATION_TEXT_LIMIT = 2000;
export const EVALUATION_REASON_LIMIT = 300;

function normalizedWord(text) {
  return text.normalize('NFD').replace(/\p{M}|\p{P}/gu, '').trim().toLowerCase();
}

export function suggestedMark(expected, decision) {
  const word = normalizedWord(expected);
  if (!decision || !/^[\p{L}\p{N}]+$/u.test(word)) return null;
  return word === normalizedWord(decision);
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});

export function formatEvaluationDate(value) {
  return dateFormat.format(new Date(value));
}

export function caseVersionLabel(version) {
  return version === 1 ? 'Versão original (1)' : 'Versão ' + version + ' · editada';
}

export function resultStatus(result) {
  if (result.estado === 'executando') return { key: 'executando', label: 'Em execução' };
  if (result.estado === 'pendente') return { key: 'pendente', label: 'Na fila' };
  if (result.estado === 'erro_chamada') return { key: 'erro', label: 'Erro na chamada' };
  if (result.estado === 'erro_execucao') return { key: 'erro', label: 'Erro na execução' };
  if (result.passou === true) return { key: 'passou', label: 'Passou' };
  if (result.passou === false) return { key: 'nao-passou', label: 'Não passou' };
  return { key: 'marcacao', label: 'Aguardando marcação' };
}

export async function evaluationRequest({ query = '', body } = {}) {
  const response = await fetch('/api/admin/avaliacao' + query, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    const message = response.status === 403 ? 'Seu acesso expirou. Recarregue a página para entrar novamente.' : data.erro;
    throw new Error(message, { cause: data.rodadaAtiva ? { rodadaAtiva: data.rodadaAtiva } : undefined });
  }
  return data;
}

export const instructionTypes = {
  alterar_regras: 'Pedido para alterar regras',
  forcar_resposta: 'Pedido de resposta predefinida',
  simular_autoridade: 'Mensagem com falsa identificação de autoridade',
};

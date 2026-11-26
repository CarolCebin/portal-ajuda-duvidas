import { setTimeout as delay } from 'node:timers/promises';
import { readAgentInstructions, decideChat } from './chat-provider.mjs';
import { createContentStore } from './content-store.mjs';
import { supabaseAdminRequest } from './admin-auth.mjs';

const CASE_FIELDS = 'id,entrada,esperado,motivo,versao';
const RUN_FIELDS = 'id,criada_em,concluida_em,mudancas,total,passaram,avaliados';
const RESULT_FIELDS = 'ordem,caso_id,versao_caso,entrada,esperado,motivo_caso,estado,decisao,resposta,instrucao_detectada,consultados,passou,motivo_marcacao';
const PAGE_SIZE = 200;

async function readRows(admin, table, filters, paginate = true) {
  const query = new URLSearchParams(filters);
  const rows = [];
  do {
    if (paginate) {
      query.set('offset', rows.length);
      query.set('limit', PAGE_SIZE);
    }
    const response = await supabaseAdminRequest('/rest/v1/' + table + '?' + query, { token: admin.token });
    const page = await response.json();
    rows.push(...page);
    if (!paginate || page.length < PAGE_SIZE) return rows;
  } while (true);
}

export async function evaluationOverview(admin) {
  const [casos, rodadas] = await Promise.all([
    readRows(admin, 'avaliacao_casos', { select: CASE_FIELDS, order: 'criado_em.asc,id.asc' }),
    readRows(admin, 'avaliacao_rodadas', { select: RUN_FIELDS, order: 'criada_em.desc,id.desc' }),
  ]);
  return { casos, rodadas };
}

export async function evaluationInstructionAlerts(admin) {
  return readRows(admin, 'chat_alertas_instrucao', {
    select: 'mensagem_id,mensagem_criada_em,detectado_em,tipo', order: 'detectado_em.desc,mensagem_id.asc',
  });
}

export async function activeEvaluationRun(admin) {
  const [rodada] = await readRows(admin, 'avaliacao_rodadas', {
    select: RUN_FIELDS, concluida_em: 'is.null', limit: '1',
  }, false);
  return rodada || null;
}

export async function evaluationCaseEdits(admin, id) {
  return readRows(admin, 'avaliacao_caso_edicoes', {
    select: 'versao,editado_em,email_editor,motivo_edicao,anterior,atualizado',
    caso_id: 'eq.' + id, order: 'versao.desc',
  });
}

export async function evaluationRun(admin, id) {
  const [rodada] = await readRows(admin, 'avaliacao_rodadas', { select: RUN_FIELDS, id: 'eq.' + id }, false);
  if (!rodada) return null;
  const resultados = await readRows(admin, 'avaliacao_resultados', {
    select: RESULT_FIELDS, rodada_id: 'eq.' + id, order: 'ordem.asc',
  });
  return { ...rodada, resultados };
}

export async function addEvaluationCase(admin, body) {
  const response = await supabaseAdminRequest('/rest/v1/avaliacao_casos?select=' + CASE_FIELDS, {
    token: admin.token, method: 'POST', body, headers: { Prefer: 'return=representation' },
  });
  const [caso] = await response.json();
  return caso;
}

export async function editEvaluationCase(admin, body) {
  const response = await supabaseAdminRequest('/rest/v1/rpc/avaliacao_editar_caso', { token: admin.token, method: 'POST', body });
  return response.json();
}

export async function evaluationCommand(admin, name, parameters) {
  const response = await supabaseAdminRequest('/rest/v1/rpc/avaliacao_' + name, {
    service: true, method: 'POST', body: { p_usuario: admin.id, ...parameters },
  });
  return response.json();
}

export async function evaluateCase(message, {
  readInstructions = readAgentInstructions,
  loadContent = signal => createContentStore({
    fetcher: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([options.signal, signal]) }),
  }).readContent(),
  decide = decideChat,
  wait = () => delay(3000),
} = {}) {
  let consultados = [];
  const signal = AbortSignal.timeout(30000);
  let instructions;
  let articles;
  try {
    [instructions, articles] = await Promise.all([readInstructions(), loadContent(signal)]);
  } catch {
    return { p_estado: 'erro_execucao', p_decisao: null, p_resposta: null, p_consultados: [] };
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const decision = await decide({
        session: { estado: 'ativa', tentativas: 0 },
        message,
        history: [],
        topics: articles.topicos,
        instructions,
        onConsulted: topics => { consultados = topics.map(({ id, titulo, link }) => ({ id, titulo, link })); },
      });
      return { p_estado: 'respondido', p_decisao: decision.tipo, p_resposta: decision.texto, p_consultados: consultados };
    } catch {
      if (attempt === 1) await wait();
    }
  }
  return { p_estado: 'erro_chamada', p_decisao: null, p_resposta: null, p_consultados: consultados };
}

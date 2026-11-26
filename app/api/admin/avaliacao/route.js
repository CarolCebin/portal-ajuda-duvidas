import { CHAT_MESSAGE_LIMIT } from '../../../../lib/chat.mjs';
import { EVALUATION_REASON_LIMIT, EVALUATION_TEXT_LIMIT } from '../../../../lib/avaliacao.mjs';
import { adminResponse, mutationOrigin, readAdmin } from '../../../../lib/server/admin-auth.mjs';
import {
  activeEvaluationRun, addEvaluationCase, editEvaluationCase, evaluateCase, evaluationCaseEdits, evaluationCommand, evaluationInstructionAlerts, evaluationOverview, evaluationRun,
} from '../../../../lib/server/evaluation.mjs';

export const maxDuration = 120;
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied = () => adminResponse({ erro: 'Acesso negado.' }, 403);
const unavailable = () => adminResponse({ erro: 'Não foi possível acessar a avaliação. Tente novamente.' }, 503);

function field(value, max, { required = true, oneLine = false } = {}) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) return null;
  if (oneLine && /[\r\n\u2028\u2029]/u.test(value)) return null;
  return value.trim() || (required ? null : '');
}

export async function GET(request) {
  try {
    const admin = await readAdmin(request.cookies);
    if (!admin) return denied();
    const query = request.nextUrl.searchParams;
    const caso = query.get('caso');
    if (caso !== null) {
      if (!UUID.test(caso)) return adminResponse({ erro: 'Caso inválido.' }, 400);
      return adminResponse({ edicoes: await evaluationCaseEdits(admin, caso) });
    }
    if (query.has('alertas')) return adminResponse({ alertas: await evaluationInstructionAlerts(admin) });
    if (query.has('ativa')) return adminResponse({ rodada: await activeEvaluationRun(admin) });
    const id = query.get('rodada');
    if (id === null) return adminResponse(await evaluationOverview(admin));
    if (!UUID.test(id)) return adminResponse({ erro: 'Rodada inválida.' }, 400);
    const rodada = await evaluationRun(admin, id);
    return rodada ? adminResponse({ rodada }) : adminResponse({ erro: 'Rodada não encontrada.' }, 404);
  } catch {
    return unavailable();
  }
}

export async function POST(request) {
  if (!mutationOrigin(request)) return denied();
  try {
    const admin = await readAdmin(request.cookies);
    if (!admin) return denied();
    let body;
    try { body = await request.json(); } catch {}
    if (!body || typeof body !== 'object') return adminResponse({ erro: 'Dados inválidos.' }, 400);

    if (body.acao === 'adicionar' || body.acao === 'editar') {
      const entrada = field(body.entrada, CHAT_MESSAGE_LIMIT);
      const esperado = field(body.esperado, EVALUATION_TEXT_LIMIT);
      const motivo = field(body.motivo, EVALUATION_REASON_LIMIT, { oneLine: true });
      if (!entrada || !esperado || !motivo) return adminResponse({ erro: 'Preencha os três campos do caso.' }, 400);
      if (body.acao === 'adicionar') {
        return adminResponse({ caso: await addEvaluationCase(admin, { entrada, esperado, motivo }) }, 201);
      }
      if (typeof body.caso !== 'string' || !UUID.test(body.caso)
        || !Number.isInteger(body.versao) || body.versao < 1 || body.versao > 2147483647) {
        return adminResponse({ erro: 'Caso ou versão inválida.' }, 400);
      }
      const motivoEdicao = field(body.motivoEdicao, EVALUATION_REASON_LIMIT);
      if (!motivoEdicao) return adminResponse({ erro: 'Informe por que é necessário editar este caso.' }, 400);
      const result = await editEvaluationCase(admin, {
        p_caso: body.caso, p_versao: body.versao,
        p_entrada: entrada, p_esperado: esperado, p_motivo: motivo, p_motivo_edicao: motivoEdicao,
      });
      if (result.estado === 'editado') return adminResponse({ caso: result.caso });
      if (result.estado === 'nao_encontrado') return adminResponse({ erro: 'Caso não encontrado.' }, 404);
      if (result.estado === 'sem_mudanca') return adminResponse({ erro: 'Altere pelo menos um campo antes de salvar.' }, 422);
      if (result.estado === 'desatualizado') {
        return adminResponse({ erro: 'Este caso já foi alterado. Atualize a página e abra a edição de novo.' }, 409);
      }
      return unavailable();
    }

    if (typeof body.rodada !== 'string' || !UUID.test(body.rodada)) {
      return adminResponse({ erro: 'Rodada inválida.' }, 400);
    }
    if (body.acao === 'iniciar') {
      const mudancas = field(body.mudancas, EVALUATION_TEXT_LIMIT, { required: false });
      if (mudancas === null) return adminResponse({ erro: 'Revise o texto sobre o que mudou.' }, 400);
      const id = await evaluationCommand(admin, 'iniciar', { p_id: body.rodada, p_mudancas: mudancas });
      if (!id) return adminResponse({ erro: 'Adicione um caso para começar.' }, 409);
      if (id !== body.rodada) {
        return adminResponse({ erro: 'Aguarde a rodada em andamento terminar.', rodadaAtiva: id }, 409);
      }
      return adminResponse({ id }, 201);
    }
    if (body.acao === 'executar') {
      const caso = await evaluationCommand(admin, 'proximo', { p_rodada: body.rodada });
      if (!caso) return adminResponse({ processado: false });
      const result = await evaluateCase(caso.entrada);
      const saved = await evaluationCommand(admin, 'salvar_resposta', {
        p_rodada: body.rodada, p_ordem: caso.ordem, p_inicio: caso.inicio, ...result,
      });
      return adminResponse({ processado: saved });
    }
    if (body.acao === 'marcar') {
      const motivo = field(body.motivo, EVALUATION_REASON_LIMIT, { required: false, oneLine: true });
      if (!Number.isSafeInteger(body.ordem) || body.ordem < 1 || typeof body.passou !== 'boolean' || motivo === null) {
        return adminResponse({ erro: 'Escolha uma marcação e use uma linha para o motivo.' }, 400);
      }
      const saved = await evaluationCommand(admin, 'marcar', {
        p_rodada: body.rodada, p_ordem: body.ordem, p_passou: body.passou, p_motivo: motivo,
      });
      return saved ? adminResponse({ ok: true }) : adminResponse({ erro: 'Este caso ainda não tem resposta.' }, 409);
    }
    return adminResponse({ erro: 'Ação inválida.' }, 400);
  } catch {
    return unavailable();
  }
}

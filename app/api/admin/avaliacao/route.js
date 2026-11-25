import { CHAT_MESSAGE_LIMIT } from '../../../../lib/chat.mjs';
import { EVALUATION_REASON_LIMIT, EVALUATION_TEXT_LIMIT } from '../../../../lib/avaliacao.mjs';
import { adminResponse, mutationOrigin, readAdmin } from '../../../../lib/server/admin-auth.mjs';
import {
  addEvaluationCase, evaluateCase, evaluationCommand, evaluationOverview, evaluationRun,
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
    const id = request.nextUrl.searchParams.get('rodada');
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

    if (body.acao === 'adicionar') {
      const entrada = field(body.entrada, CHAT_MESSAGE_LIMIT);
      const esperado = field(body.esperado, EVALUATION_TEXT_LIMIT);
      const motivo = field(body.motivo, EVALUATION_REASON_LIMIT, { oneLine: true });
      if (!entrada || !esperado || !motivo) return adminResponse({ erro: 'Preencha os três campos do caso.' }, 400);
      return adminResponse({ caso: await addEvaluationCase(admin, { entrada, esperado, motivo }) }, 201);
    }

    if (typeof body.rodada !== 'string' || !UUID.test(body.rodada)) {
      return adminResponse({ erro: 'Rodada inválida.' }, 400);
    }
    if (body.acao === 'iniciar') {
      const mudancas = field(body.mudancas, EVALUATION_TEXT_LIMIT, { required: false });
      if (mudancas === null) return adminResponse({ erro: 'Revise o texto sobre o que mudou.' }, 400);
      const id = await evaluationCommand(admin, 'iniciar', { p_id: body.rodada, p_mudancas: mudancas });
      return id ? adminResponse({ id }, 201) : adminResponse({ erro: 'Adicione um caso para começar.' }, 409);
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

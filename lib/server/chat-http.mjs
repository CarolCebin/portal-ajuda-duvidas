import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CHAT_MESSAGE_LIMIT } from '../chat.mjs';
import { createContentStore } from './content-store.mjs';
import { chatOperation } from './chat-store.mjs';
import { decideChat, hasGeminiKey, readAgentInstructions, topicLink } from './chat-provider.mjs';

const COOKIE = 'central_ajuda_chat';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ['iniciar', 'nova', 'mensagem', 'resolveu', 'nao_resolveu', 'encerrar', 'suporte'];
const FEEDBACK = { resolveu: 'Sim, a orientação resolveu minha dúvida.', nao_resolveu: 'Não, a orientação não resolveu minha dúvida.' };
const ERRORS = {
  GEMINI_SEM_CHAVE: 'O assistente ainda está sendo configurado.',
  GEMINI_ACESSO: 'Não foi possível autenticar no serviço do assistente.',
  GEMINI_COTA: 'O assistente atingiu o limite de uso. Tente mais tarde.',
  GEMINI_INDISPONIVEL: 'O assistente está indisponível no momento. Tente novamente.',
  FICHA_INDISPONIVEL: 'As instruções do assistente estão indisponíveis.',
  DECISAO_INVALIDA: 'O assistente devolveu uma resposta em formato inesperado. Tente novamente.',
};

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('BODY');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12000) {
      await reader.cancel();
      throw new Error('BODY');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function present(result, topics = []) {
  if (!result.sessao || result.sessao.cenario !== 'gemini') return { sessao: null, mensagens: [], resultado: result.resultado };
  const { id, estado, versao, tentativas, expiraEm } = result.sessao;
  const titles = new Map(topics.map(topic => [topic.id, topic.titulo]));
  return {
    sessao: { id, estado, versao, tentativas, expiraEm },
    mensagens: result.mensagens.map(({ instrucaoDetectada, ...message }) => ({
      ...message,
      links: message.fontes.map(id => ({ id, href: topicLink(id), titulo: titles.get(id) })),
    })),
    resultado: result.resultado,
  };
}

export function makeChatHandler({
  operation = chatOperation,
  content = () => createContentStore().readContent(),
  readInstructions = readAgentInstructions,
  decide = decideChat,
  configured = hasGeminiKey,
} = {}) {
  return async function handle(request) {
    const url = new URL(request.url);
    const existing = request.headers.get('cookie')?.split(';').map(value => value.trim())
      .find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    const validCookie = /^[a-f0-9]{64}$/.test(existing || '');
    const token = validCookie ? existing : randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const cookie = COOKIE + '=' + token + '; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=1800'
      + (url.protocol === 'https:' ? '; Secure' : '');
    const response = (data, status = 200) => Response.json({ disponivel: configured(), ...data }, {
      status,
      headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Set-Cookie': cookie },
    });
    const consult = () => operation({ p_hash: hash, p_acao: 'consultar' });

    try {
      if (request.method === 'GET') {
        return response(validCookie ? present(await consult()) : { sessao: null, mensagens: [] });
      }
      if (request.method !== 'POST') return response({ error: 'Método indisponível.' }, 405);

      // Next pode normalizar request.url para localhost. Host preserva o destino recebido.
      let origin;
      try { origin = new URL(request.headers.get('origin')); } catch {}
      if (!origin || !['http:', 'https:'].includes(origin.protocol)
        || origin.host !== (request.headers.get('host') || url.host)
        || request.headers.get('sec-fetch-site') === 'cross-site') {
        return response({ error: 'Solicitação não permitida.' }, 403);
      }
      if (!validCookie) return response({ error: 'Atualize a conversa antes de continuar.' }, 409);

      let body;
      try {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('BODY');
        body = await readBody(request);
      } catch { return response({ error: 'Mensagem inválida.' }, 400); }

      if (!body || !ACTIONS.includes(body.acao) || !UUID.test(body.requestId || '')
        || (body.sessaoId != null && !UUID.test(body.sessaoId))
        || (body.versao != null && (!Number.isSafeInteger(body.versao) || body.versao < 0))) {
        return response({ error: 'Solicitação inválida.' }, 400);
      }

      const action = body.acao;
      const feedback = Object.hasOwn(FEEDBACK, action) ? action : null;
      const args = {
        p_hash: hash, p_acao: feedback ? 'mensagem' : action, p_request: body.requestId,
        p_sessao: body.sessaoId || null, p_versao: body.versao ?? null, p_dados: {},
      };
      let topics = [];
      if (action === 'iniciar' || action === 'nova') {
        if (!configured()) throw new Error('GEMINI_SEM_CHAVE');
        args.p_dados = { cenario: 'gemini' };
      } else if (action === 'mensagem' || feedback) {
        const text = feedback ? FEEDBACK[feedback] : body.texto;
        if (typeof text !== 'string' || !text.trim() || text.length > CHAT_MESSAGE_LIMIT) {
          return response({ error: 'Escreva uma mensagem com até ' + CHAT_MESSAGE_LIMIT + ' caracteres.' }, 400);
        }
        if (!configured()) throw new Error('GEMINI_SEM_CHAVE');
        const firstMessage = action === 'mensagem' && args.p_sessao === null && args.p_versao === null;
        let current = await consult();
        if (firstMessage && current.sessao?.cenario !== 'gemini') {
          // A sessão e a mensagem têm identificadores distintos para permitir o reenvio.
          current = await operation({ p_hash: hash, p_acao: 'iniciar', p_request: randomUUID(), p_dados: { cenario: 'gemini' } });
        }
        const session = current.sessao;
        if (!session || session.cenario !== 'gemini') {
          return response({ error: 'Esta conversa expirou. Inicie uma nova dúvida.', expirada: true }, 410);
        }
        if ((firstMessage || session.id === args.p_sessao) && session.ultimoRequest === args.p_request) return response(present(current));
        if (firstMessage) {
          args.p_sessao = session.id;
          args.p_versao = 0;
        }
        if (session.id !== args.p_sessao || session.versao !== args.p_versao) {
          return response({ error: 'A conversa mudou. Atualize antes de continuar.' }, 409);
        }
        if (['encerrado', 'encaminhado'].includes(session.estado) || (feedback && session.estado !== 'confirmacao')) {
          return response({ error: 'Esta conversa não aceita essa mensagem. Inicie uma nova dúvida.' }, 409);
        }
        const [instructions, articles] = await Promise.all([readInstructions(), content()]);
        topics = articles.topicos;
        const input = { session, message: text.trim(), history: current.mensagens, topics, instructions, feedback };
        let decision;
        try {
          decision = await decide(input);
        } catch (error) {
          if (error.message !== 'DECISAO_INVALIDA') throw error;
          decision = await decide(input);
        }
        args.p_dados = { usuario: text.trim(), ...decision };
      }

      const result = await operation(args);
      if (result.erro) {
        const expired = result.erro === 'expirada';
        return response({
          error: expired ? 'Esta conversa expirou. Inicie uma nova dúvida.' : 'A conversa mudou. Atualize antes de continuar.',
          expirada: expired,
        }, expired ? 410 : 409);
      }
      return response(present(result, topics));
    } catch (error) {
      return response({ error: ERRORS[error?.message] || 'Não foi possível acessar a conversa. Tente novamente.' }, 503);
    }
  };
}

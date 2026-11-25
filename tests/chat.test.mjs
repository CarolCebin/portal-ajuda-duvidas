import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decideChat, selectRelevantTopics } from '../lib/server/chat-provider.mjs';
import { makeChatHandler } from '../lib/server/chat-http.mjs';

const session = { id: randomUUID(), cenario: 'gemini', tentativas: 1, versao: 1, estado: 'ativa' };
const topic = { id: 'buscar-orientacao', titulo: 'Como pesquisar uma orientação', conteudo: 'Use o campo de busca.' };
const history = [{ autor: 'usuario', tipo: 'mensagem', texto: 'Quero pesquisar uma orientação.', fontes: [] }];
const orientation = { tipo: 'orientar', texto: 'Use o campo de busca.', fontes: [topic.id], perguntaResolucao: 'Isso resolveu sua dúvida?' };
const base = { session, message: 'Onde posso pesquisar?', history, topics: [topic], instructions: '# Ficha de teste' };
const answers = data => async () => JSON.stringify(data);

test('Gemini recebe a ficha completa, a mensagem, o contexto, as tentativas e os links relevantes', async () => {
  const decision = await decideChat({ ...base, generate: async request => {
    const input = JSON.parse(request.contents);
    assert.equal(request.model, 'gemini-3.5-flash-lite');
    assert.ok(request.config.systemInstruction.startsWith(base.instructions + '\n'));
    assert.equal(input.mensagem, base.message);
    assert.deepEqual(input.conversaAtual, history);
    assert.equal(input.tentativasRealizadas, 1);
    assert.equal(input.topicosRelevantes[0].link, '/topicos/buscar-orientacao');
    assert.equal(input.topicosRelevantes[0].conteudo, topic.conteudo);
    return JSON.stringify(orientation);
  } });
  assert.deepEqual(decision, { tipo: 'orientar', texto: orientation.texto + '\n\n' + orientation.perguntaResolucao, fontes: [topic.id] });
});

test('seleção descarta tópicos não relacionados e preserva o assunto de uma pergunta curta', () => {
  assert.deepEqual(selectRelevantTopics([topic], 'Qual é a capital da Islândia?', []), []);
  assert.equal(selectRelevantTopics([topic], 'E depois?', history)[0].id, topic.id);
});

test('respostas inválidas não passam ao servidor de gravação', async () => {
  const invalid = [
    { ...orientation, fontes: ['inventado'] },
    { ...orientation, fontes: [] },
    { ...orientation, perguntaResolucao: '' },
    { ...orientation, texto: 'Use https://exemplo.invalid.' },
    { ...orientation, campoExtra: 'análise do agente' },
    { tipo: 'esclarecer', texto: 'Isto não é uma pergunta.', fontes: [], perguntaResolucao: '' },
  ];
  for (const decision of invalid) {
    await assert.rejects(decideChat({ ...base, generate: answers(decision) }), /DECISAO_INVALIDA/);
  }
});

test('limite impede uma quarta tentativa e feedback explícito restringe o tipo de resposta', async () => {
  await assert.rejects(decideChat({ ...base, session: { ...session, tentativas: 3 }, generate: answers(orientation) }), /DECISAO_INVALIDA/);
  await assert.rejects(decideChat({ ...base, feedback: 'nao_resolveu', generate: answers(orientation) }), /DECISAO_INVALIDA/);
  const closure = await decideChat({ ...base, feedback: 'resolveu', generate: answers({
    tipo: 'encerrar', texto: 'Que bom que ajudou. Atendimento encerrado.', fontes: [], perguntaResolucao: '',
  }) });
  assert.equal(closure.tipo, 'encerrar');
});

const cookie = 'central_ajuda_chat=' + 'a'.repeat(64);
function post(overrides = {}, headers = {}) {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', cookie, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ acao: 'mensagem', requestId: randomUUID(), sessaoId: session.id, versao: session.versao, texto: 'Como pesquisar?', ...overrides }),
  });
}

test('cada mensagem relê a ficha e grava a decisão, retornando links internos', async () => {
  let reads = 0;
  const writes = [];
  const decisions = [];
  const handle = makeChatHandler({
    configured: () => true,
    content: async () => ({ topicos: [topic] }),
    readInstructions: async () => 'Versão ' + ++reads,
    decide: async input => {
      decisions.push(input);
      return { tipo: 'orientar', texto: input.instructions, fontes: [topic.id] };
    },
    operation: async args => {
      if (args.p_acao === 'consultar') return { sessao: session, mensagens: history };
      writes.push(args);
      return { sessao: session, mensagens: [{ autor: 'assistente', ...args.p_dados }] };
    },
  });
  for (let revision = 1; revision <= 2; revision++) {
    const response = await handle(post());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mensagens[0].texto, 'Versão ' + revision);
    assert.equal(data.mensagens[0].links[0].href, '/topicos/buscar-orientacao');
  }
  assert.deepEqual(decisions[1].history, history);
  assert.equal(writes[1].p_dados.usuario, 'Como pesquisar?');
  assert.equal(writes[1].p_dados.tipo, 'orientar');
});

test('reenvio confirmado usa a decisão salva sem consultar o Gemini novamente', async () => {
  const requestId = randomUUID();
  const handle = makeChatHandler({
    configured: () => true,
    operation: async () => ({ sessao: { ...session, ultimoRequest: requestId, versao: 2 }, mensagens: [] }),
    decide: () => assert.fail('O Gemini não deve ser chamado.'),
  });
  const response = await handle(post({ requestId }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessao.ultimoRequest, undefined);
});

test('o primeiro envio cria a sessão e um reenvio usa a resposta já gravada', async () => {
  const requestId = randomUUID();
  let current = { sessao: null, mensagens: [] };
  let decisions = 0;
  const handle = makeChatHandler({
    configured: () => true,
    content: async () => ({ topicos: [] }),
    readInstructions: async () => 'Ficha',
    decide: async ({ session, history, message }) => {
      decisions++;
      assert.equal(session.tentativas, 0);
      assert.deepEqual(history, []);
      assert.equal(message, 'Como pesquisar?');
      return { tipo: 'esclarecer', texto: 'Qual informação você quer pesquisar?', fontes: [] };
    },
    operation: async args => {
      if (args.p_acao === 'consultar') return current;
      if (args.p_acao === 'iniciar') {
        assert.notEqual(args.p_request, requestId);
        current = { sessao: { ...session, versao: 0, tentativas: 0 }, mensagens: [] };
        return current;
      }
      assert.equal(args.p_sessao, session.id);
      assert.equal(args.p_versao, 0);
      current = {
        sessao: { ...session, ultimoRequest: args.p_request, estado: 'esclarecimento' },
        mensagens: [{ autor: 'assistente', tipo: args.p_dados.tipo, texto: args.p_dados.texto, fontes: [] }],
      };
      return current;
    },
  });
  const input = { requestId, sessaoId: undefined, versao: undefined };
  const first = await handle(post(input));
  assert.equal(first.status, 200);
  const reply = await first.json();
  assert.equal(reply.sessao.estado, 'esclarecimento');
  const retry = await handle(post(input));
  assert.deepEqual(await retry.json(), reply);
  const outdated = await handle(post({ ...input, requestId: randomUUID() }));
  assert.equal(outdated.status, 409);
  assert.equal(decisions, 1);
});

test('sem chave, o chat informa que a configuração está pendente sem chamar serviços', async () => {
  const handle = makeChatHandler({ configured: () => false, operation: () => assert.fail('Consulta inesperada.') });
  const first = await handle(new Request('https://example.test/api/chat'));
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=1800; Secure/);
  assert.equal((await first.json()).disponivel, false);
  assert.equal((await handle(post())).status, 503);
});

test('origem externa, mensagens grandes e sessões antigas são recusadas antes da decisão', async () => {
  const handle = makeChatHandler({
    configured: () => true,
    operation: async () => ({ sessao: { ...session, cenario: 'orientacao' }, mensagens: [] }),
    decide: () => assert.fail('O Gemini não deve ser chamado.'),
  });
  assert.equal((await handle(post({}, { origin: 'https://estranho.example' }))).status, 403);
  assert.equal((await handle(post({ texto: 'a'.repeat(13000) }))).status, 400);
  assert.equal((await handle(post())).status, 410);
});

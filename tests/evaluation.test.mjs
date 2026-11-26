import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideChat } from '../lib/server/chat-provider.mjs';
import { evaluateCase } from '../lib/server/evaluation.mjs';
import { suggestedMark } from '../lib/avaliacao.mjs';
import { GET, POST } from '../app/api/admin/avaliacao/route.js';

test('a sugestão compara somente uma palavra, ignorando caixa, acentos e pontuação', () => {
  assert.equal(suggestedMark('ÓRIENTAR!', 'orientar'), true);
  assert.equal(suggestedMark('Orientar.', 'esclarecer'), false);
  assert.equal(suggestedMark('Dar orientação.', 'orientar'), null);
  assert.equal(suggestedMark('!', 'orientar'), null);
  assert.equal(suggestedMark('Orientar', null), null);
});

test('a rodada usa a decisão do chat e guarda todos os tópicos enviados, inclusive os que não foram citados', async () => {
  const topics = [
    { id: 'senha', titulo: 'Redefinir senha', conteudo: 'Mudar a senha do aplicativo.' },
    { id: 'seguranca', titulo: 'Segurança', conteudo: 'Proteja a senha da conta.' },
    { id: 'cobranca', titulo: 'Cobrança', conteudo: 'Atualize seu cartão.' },
  ];
  const result = await evaluateCase('Como redefinir minha senha?', {
    readInstructions: async () => 'Ficha atual',
    loadContent: async () => ({ topicos: topics }),
    decide: input => decideChat({
      ...input,
      generate: async payload => {
        const prompt = JSON.parse(payload.contents);
        assert.equal(prompt.estadoDaConversa, 'ativa');
        assert.equal(prompt.tentativasRealizadas, 0);
        assert.deepEqual(prompt.conversaAtual, []);
        assert.match(payload.config.systemInstruction, /^Ficha atual/);
        assert.deepEqual(prompt.topicosRelevantes.map(topic => topic.id), ['senha', 'seguranca']);
        return JSON.stringify({ tipo: 'orientar', texto: 'Redefina sua senha.', fontes: ['senha'], perguntaResolucao: 'Resolveu?' });
      },
    }),
  });
  assert.equal(result.p_estado, 'respondido');
  assert.equal(result.p_decisao, 'orientar');
  assert.match(result.p_resposta, /Redefina sua senha/);
  assert.deepEqual(result.p_consultados.map(topic => topic.id), ['senha', 'seguranca']);
});

test('a chamada que falha espera, tenta uma vez e registra o erro do caso', async () => {
  const calls = [];
  const result = await evaluateCase('Caso', {
    readInstructions: async () => 'Ficha',
    loadContent: async () => ({ topicos: [] }),
    wait: async () => { calls.push('espera'); },
    decide: async ({ onConsulted }) => {
      calls.push('chamada');
      onConsulted([{ id: 'teste', titulo: 'Teste', link: '/topicos/teste' }]);
      throw new Error('indisponível');
    },
  });
  assert.deepEqual(calls, ['chamada', 'espera', 'chamada']);
  assert.equal(result.p_estado, 'erro_chamada');
  assert.equal(result.p_resposta, null);
  assert.equal(result.p_consultados[0].id, 'teste');
});

test('a API recusa visitantes e contas confirmadas sem a marca de administradora', async t => {
  const origin = 'http://localhost:3000';
  const nextUrl = new URL('/api/admin/avaliacao', origin);
  const headers = new Headers({ origin, host: nextUrl.host });
  const testEnv = {
    SUPABASE_URL: 'https://avaliacao.example',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
    SUPABASE_SECRET_KEY: 'sb_secret_teste',
  };
  for (const [name, value] of Object.entries(testEnv)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async address => {
    const path = new URL(address).pathname;
    calls.push(path);
    if (path === '/auth/v1/user') return Response.json({ id: 'conta-teste', email_confirmed_at: '2026-11-25' });
    if (path === '/rest/v1/avaliacao_admin') return Response.json([]);
    assert.fail('A API deve negar o acesso antes de consultar ou gravar avaliações.');
  });

  const guest = { nextUrl, headers, cookies: { get: () => undefined } };
  assert.equal((await GET(guest)).status, 403);
  assert.deepEqual(calls, []);
  const other = { ...guest, cookies: { get: () => ({ value: 'teste.de.sessao' }) } };
  assert.equal((await GET(other)).status, 403);
  assert.equal((await POST(other)).status, 403);
  assert.deepEqual(calls, [
    '/auth/v1/user', '/rest/v1/avaliacao_admin',
    '/auth/v1/user', '/rest/v1/avaliacao_admin',
  ]);
});

test('a API exige motivo de edição e usa a sessão verificada para atribuir a autoria', async t => {
  const id = '11111111-1111-4111-8111-111111111111';
  const run = '22222222-2222-4222-8222-222222222222';
  const origin = 'http://localhost:3000';
  const nextUrl = new URL('/api/admin/avaliacao', origin);
  const testEnv = {
    SUPABASE_URL: 'https://avaliacao.example',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
    SUPABASE_SECRET_KEY: 'sb_secret_teste',
  };
  for (const [name, value] of Object.entries(testEnv)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }

  const edits = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const path = new URL(address).pathname;
    if (path === '/auth/v1/user') return Response.json({ id, email_confirmed_at: '2026-11-25' });
    if (path === '/rest/v1/avaliacao_admin') return Response.json([{ usuario_id: id }]);
    if (path === '/rest/v1/rpc/avaliacao_editar_caso') {
      edits.push({ headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({ estado: 'editado', caso: { id, versao: 2 } });
    }
    if (path === '/rest/v1/rpc/avaliacao_iniciar') return Response.json(run);
    assert.fail('Consulta não esperada.');
  });

  function request(body) {
    return {
      nextUrl, headers: new Headers({ origin, host: nextUrl.host }),
      cookies: { get: () => ({ value: 'teste.de.sessao' }) }, json: async () => body,
    };
  }

  const edit = { acao: 'editar', caso: id, versao: 1, entrada: 'Exemplo', esperado: 'orientar', motivo: 'Entrada normal' };
  assert.equal((await POST(request({ ...edit, motivoEdicao: '   ' }))).status, 400);
  assert.equal(edits.length, 0);
  assert.equal((await POST(request({ ...edit, motivoEdicao: 'Atualizar critério.', p_email: 'Outra conta' }))).status, 200);
  assert.deepEqual(edits, [{
    headers: { apikey: testEnv.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer teste.de.sessao', 'Content-Type': 'application/json' },
    body: { p_caso: id, p_versao: 1, p_entrada: 'Exemplo', p_esperado: 'orientar', p_motivo: 'Entrada normal', p_motivo_edicao: 'Atualizar critério.' },
  }]);

  const blocked = await POST(request({ acao: 'iniciar', rodada: id, mudancas: '' }));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).rodadaAtiva, run);
});

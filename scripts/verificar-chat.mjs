import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadLocalEnvironment } from './env-local.mjs';
import { getSupabaseConfig } from '../lib/server/content-store.mjs';

loadLocalEnvironment();
if (!process.env.GEMINI_API_KEY?.trim()) {
  console.error('GEMINI_API_KEY está vazia. Preencha apenas no .env.local antes de verificar.');
  process.exit(1);
}
const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
  throw new Error('Use um endereço local.');
}
const config = getSupabaseConfig();
const cases = [
  { name: 'clara', text: 'Como pesquisar uma orientação na Central de Ajuda?', type: 'orientar', state: 'confirmacao', attempts: 1 },
  { name: 'fora do assunto', text: 'Qual é a capital da Islândia?', type: 'encaminhar', state: 'encaminhado', attempts: 0 },
  { name: 'ambígua', text: 'Não aparece. O que eu faço?', type: 'esclarecer', state: 'esclarecimento', attempts: 1 },
];

async function readDatabase(table, query, method = 'GET') {
  const url = new URL(config.url + '/rest/v1/' + table);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method, headers: { apikey: config.secretKey, Prefer: 'return=representation' },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, 'Consulta de verificação falhou (HTTP ' + response.status + ').');
  return response.json();
}

async function verify(example) {
  let cookie = '';
  let session;
  async function chat(action, extra = {}) {
    const options = { cache: 'no-store', signal: AbortSignal.timeout(45000) };
    options.headers = cookie ? { cookie } : {};
    if (action) {
      options.method = 'POST';
      options.headers.origin = base.origin;
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ acao: action, requestId: randomUUID(), sessaoId: session?.id, versao: session?.versao, ...extra });
    }
    const response = await fetch(new URL('/api/chat', base), options);
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    const data = await response.json();
    assert.ok(response.ok, 'Chat retornou HTTP ' + response.status + '. ' + (data.error || ''));
    return data;
  }

  try {
    assert.equal((await chat()).disponivel, true, 'Reinicie o app para que o servidor leia a chave configurada.');
    const data = await chat('mensagem', { texto: example.text });
    session = data.sessao;
    assert.ok(session?.id, 'A sessão não foi criada pelo primeiro envio.');
    const message = data.mensagens.at(-1);
    assert.ok(message?.texto && message.autor === 'assistente', 'Resposta do assistente ausente.');
    assert.equal(data.mensagens[0].texto, example.text);
    const rows = await readDatabase('mensagens_chat', { id: 'eq.' + message.id, sessao_id: 'eq.' + session.id, select: 'autor,tipo,texto,fontes' });
    assert.deepEqual(rows, [{ autor: 'assistente', tipo: message.tipo, texto: message.texto, fontes: message.fontes }]);
    const states = await readDatabase('sessoes_chat', { id: 'eq.' + session.id, select: 'estado,tentativas' });
    assert.deepEqual(states, [{ estado: session.estado, tentativas: session.tentativas }]);
    console.log(JSON.stringify({ caso: example.name, resposta: message.texto, tipo: message.tipo, estado: session.estado, fontes: message.fontes, confirmadoNoBanco: true }));
    assert.equal(message.tipo, example.type, 'A decisão divergiu do caso esperado. Confira a resposta e a seção 6 da ficha.');
    assert.equal(session.estado, example.state);
    assert.equal(session.tentativas, example.attempts);
    if (example.type === 'orientar') {
      assert.ok(message.texto.endsWith('?'));
      assert.ok(message.fontes.length);
      assert.deepEqual(message.links.map(link => link.href), message.fontes.map(id => '/topicos/' + encodeURIComponent(id)));
    } else {
      assert.deepEqual(message.fontes, []);
      assert.deepEqual(message.links, []);
      if (example.type === 'esclarecer') assert.ok(message.texto.endsWith('?'));
    }
  } finally {
    if (!session && cookie) session = (await chat()).sessao;
    if (session?.id) {
      await readDatabase('sessoes_chat', { id: 'eq.' + session.id }, 'DELETE');
      assert.deepEqual(await readDatabase('mensagens_chat', { sessao_id: 'eq.' + session.id, select: 'id' }), []);
    }
  }
}

for (const example of cases) {
  try { await verify(example); }
  catch (error) {
    console.error('Falhou (' + example.name + '). ' + (error instanceof assert.AssertionError ? error.message : 'Falha na conexão ou na verificação.'));
    process.exitCode = 1;
  }
}

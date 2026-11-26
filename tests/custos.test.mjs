import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseCostSettings, summarizeModelCosts } from '../lib/custos.mjs';
import { meterModelCall } from '../lib/server/ai-usage.mjs';
import { makeChatHandler } from '../lib/server/chat-http.mjs';
import { GET, POST } from '../app/api/admin/custos/route.js';

const defaultPrices = { entrada_usd: 0.30, saida_usd: 2.50, dolar_brl: null, limite_diario: 30 };

test('calcula o total em duas moedas e projeta mil usos do app sem misturar avaliações ou medições ausentes', () => {
  const data = {
    configuracao: { ...defaultPrices, dolar_brl: 5 },
    origens: {
      app: { chamadas: 3, medidas: 2, com_duracao: 3, duracao_total_ms: 1800, tokens_entrada: 4000, tokens_saida: 800 },
      avaliacao: { chamadas: 1, medidas: 1, com_duracao: 1, duracao_total_ms: 200, tokens_entrada: 2000, tokens_saida: 400 },
    },
  };
  const { totalBrl, ...stats } = summarizeModelCosts(data);
  assert.ok(Math.abs(totalBrl - 0.024) < 1e-12);
  assert.deepEqual(stats, {
    chamadas: 4, medidas: 3, tempoMedioMs: 500, totalUsd: 0.0048,
    medioUsd: 0.0016, medioBrl: 0.008, milUsd: 1.6, milBrl: 8,
  });
  assert.equal(summarizeModelCosts(data, 'avaliacao').totalUsd, 0.0016);
  assert.equal(summarizeModelCosts(data, 'avaliacao').tempoMedioMs, 200);
  assert.equal(summarizeModelCosts({ ...data, configuracao: defaultPrices }).totalBrl, null);
  assert.equal(summarizeModelCosts({ configuracao: defaultPrices, origens: { app: { chamadas: 1 } } }).totalUsd, null);
});

test('aceita valores em português, câmbio em branco e limite inteiro positivo', () => {
  const edit = { entrada_usd: '0,30', saida_usd: '2.50', dolar_brl: '', limite_diario: '30' };
  assert.deepEqual(parseCostSettings(edit), defaultPrices);
  assert.deepEqual(parseCostSettings({ ...edit, dolar_brl: '5,45', limite_diario: '120' }), { ...defaultPrices, dolar_brl: 5.45, limite_diario: 120 });
  for (const invalid of [{ dolar_brl: '0' }, { entrada_usd: '-0,2' }, { saida_usd: '2e3' }, { limite_diario: '30,5' }, { limite_diario: '0' }]) {
    assert.equal(parseCostSettings({ ...edit, ...invalid }), null);
  }
});

test('reserva antes de chamar Gemini e soma os tokens de raciocínio à saída', async () => {
  const events = [];
  const begin = { model: 'gemini-3.5-flash-lite', origin: 'app', browserHash: 'a'.repeat(64) };
  const response = { usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20, thoughtsTokenCount: 50 } };
  let reservedId;
  const times = [12, 156];
  const result = await meterModelCall({ ...begin, generate: async () => { events.push('gemini'); return response; } }, {
    reserve: async ({ id, ...params }) => { assert.deepEqual(params, begin); reservedId = id; events.push('reserva'); return true; },
    finish: async (id, metrics) => {
      assert.equal(id, reservedId);
      assert.deepEqual(metrics, { estado: 'respondida', duracao_ms: 144, tokens_entrada: 200, tokens_saida: 70 });
      events.push('gravação');
    },
    clock: () => times.shift(),
  });
  assert.equal(result, response);
  assert.deepEqual(events, ['reserva', 'gemini', 'gravação']);
});

test('cota negada não chama o modelo e falha na avaliação grava a latência sem inventar tokens', async () => {
  await assert.rejects(meterModelCall({ origin: 'app', generate: () => assert.fail() }, {
    reserve: async () => false, finish: () => assert.fail(),
  }), /LIMITE_DIARIO_IA/);
  const error = new Error('falha do provedor');
  await assert.rejects(meterModelCall({ origin: 'avaliacao', generate: () => { throw error; } }, {
    reserve: async args => { assert.equal(args.origin, 'avaliacao'); assert.equal(args.browserHash, undefined); return true; },
    finish: async (id, metrics) => {
      assert.deepEqual(metrics, { estado: 'falhou', duracao_ms: 0, tokens_entrada: null, tokens_saida: null });
    },
    clock: () => 50,
  }), error);
});

test('chat devolve aviso de cota e mantém o identificador entre conversas', async () => {
  const id = randomUUID();
  const hashes = [];
  const handle = makeChatHandler({
    configured: () => true,
    operation: async ({ p_acao }) => {
      assert.equal(p_acao, 'consultar');
      return { sessao: { id, cenario: 'gemini', versao: 0, estado: 'ativa' }, mensagens: [] };
    },
    content: async () => ({ topicos: [] }),
    readInstructions: async () => 'Ficha',
    decide: async ({ usage }) => {
      assert.equal(usage.origin, 'app');
      hashes.push(usage.browserHash);
      throw new Error('LIMITE_DIARIO_IA');
    },
  });
  for (const chatToken of ['a', 'b']) {
    const response = await handle(new Request('http://localhost:3000/api/chat', {
      method: 'POST', headers: {
        origin: 'http://localhost:3000', 'content-type': 'application/json',
        cookie: 'central_ajuda_chat=' + chatToken.repeat(64) + '; central_ajuda_cota=' + 'c'.repeat(64),
      },
      body: JSON.stringify({ acao: 'mensagem', texto: 'Dúvida', requestId: randomUUID(), sessaoId: id, versao: 0 }),
    }));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).limiteDiario, true);
    assert.equal(response.headers.getSetCookie().length, 2);
  }
  assert.match(hashes[0], /^[0-9a-f]{64}$/);
  assert.equal(hashes[0], hashes[1]);
});

test('a API autoriza somente a administradora e valida a edição antes de gravar', async t => {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://custos.example',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
    SUPABASE_SECRET_KEY: 'sb_secret_teste',
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  let admin = false;
  const reads = [];
  const updates = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const path = new URL(address).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: 'conta-teste', email_confirmed_at: '2026-11-25' });
    if (path === '/rest/v1/avaliacao_admin') return Response.json(admin ? [{ usuario_id: 'conta-teste' }] : []);
    if (path === '/rest/v1/rpc/ia_resumo_custos') {
      reads.push(options.method);
      return Response.json({ configuracao: defaultPrices, origens: {} });
    }
    if (path === '/rest/v1/ia_configuracao_custos') {
      const settings = JSON.parse(options.body);
      updates.push(settings);
      return Response.json([{ unica: true, ...settings }]);
    }
    assert.fail('Consulta inesperada.');
  });
  const nextUrl = new URL('http://localhost:3000/api/admin/custos');
  const edit = { entrada_usd: '0,30', saida_usd: '2,50', dolar_brl: '5,10', limite_diario: '15' };
  function request(input, token = 'teste.de.sessao', origin = nextUrl.origin) {
    return { nextUrl, headers: new Headers({ origin, host: nextUrl.host }),
      cookies: { get: () => token ? { value: token } : undefined }, json: async () => input };
  }
  assert.equal((await GET(request(null, ''))).status, 403);
  assert.equal((await GET(request(null))).status, 403);
  assert.equal((await POST(request(edit))).status, 403);
  assert.deepEqual(reads, []);
  assert.deepEqual(updates, []);
  admin = true;
  assert.deepEqual((await (await GET(request(null))).json()).configuracao, defaultPrices);
  assert.equal((await POST(request(edit, 'teste.de.sessao', 'https://origem-externa.example'))).status, 403);
  assert.equal((await POST(request({ ...edit, limite_diario: '0' }))).status, 400);
  assert.deepEqual(updates, []);
  const saved = await POST(request(edit));
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).configuracao, { ...defaultPrices, dolar_brl: 5.1, limite_diario: 15 });
  assert.equal(updates.length, 1);
});

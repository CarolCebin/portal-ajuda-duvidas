import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contentText, emailConfigured, emptyForm, formatDate, paginate, parsePath, safeMediaUrl, searchTopics, sendSupport, validateData, validateForm, videoSource, OTHER_CATEGORY } from '../lib/help.mjs';
const data = JSON.parse(await readFile(new URL('../data/ajuda-inicial.json', import.meta.url), 'utf8'));
const valid = { nome: ' Ana Silva ', email: ' ana@example.com ', categoria: data.categorias[0].nome, assunto: ' Uma dúvida ', descricao: ' Preciso de uma orientação. ' };
const config = { emailjs: { serviceId: 'test-service', templateId: 'test-template', publicKey: 'test-public', supportEmail: 'suporte@example.com' } };

test('o arquivo preserva categorias e tópicos válidos e a ordem cadastrada', () => {
  assert.equal(validateData(data), data);
  assert.equal(data.categorias.length, 6);
  assert.equal(data.topicos.length, 28);
  assert.deepEqual(searchTopics(data.topicos, 'aplicativo').map(t => t.id), data.topicos.map(t => t.id));
});
test('busca ignora acentos, caixa e espaços nas extremidades', () => {
  const list = [{ titulo: 'Informações de COBRANÇA', conteudo: '' }, { titulo: 'Outro', conteudo: 'Veja as informações de cobrança disponíveis.' }];
  assert.equal(searchTopics(list, '  INFORMACOES DE cobranca ').length, 2);
});
test('busca exige a sequência inteira no título OU no conteúdo', () => {
  const list = [{ titulo: 'pagar agora', conteudo: '' }, { titulo: 'pagar', conteudo: 'agora' }, { titulo: 'pagar depois agora', conteudo: '' }];
  assert.deepEqual(searchTopics(list, 'pagar agora'), [list[0]]);
  assert.deepEqual(searchTopics(list, '   '), []);
  assert.deepEqual(searchTopics(list, 'termo-inexistente'), []);
});
test('busca inclui conteúdo das listas e parágrafos', () => {
  const topic = { titulo: 'Tema', conteudo: [{ tipo: 'titulo', texto: 'Informações' }, { tipo: 'passos', itens: ['Primeiro passo', 'Segundo passo'] }] };
  assert.equal(searchTopics([topic], 'segundo passo').length, 1);
  assert.equal(contentText(topic.conteudo), 'Informações\nPrimeiro passo\nSegundo passo');
});
test('paginação da categoria não inclui outras categorias e exibe os 12 tópicos', () => {
  const items = data.topicos.filter(t => t.categoriaId === 'primeiros-passos');
  assert.equal(paginate(items, 1).items.length, 10);
  assert.equal(paginate(items, 2).items.length, 2);
  assert.deepEqual([...paginate(items, 1).items, ...paginate(items, 2).items], items);
  assert.equal(paginate(items, 99).page, 2);
  assert.equal(paginate([], -1).pages, 1);
});
test('paginação da busca encontra todas as categorias sem reordenar', () => {
  const matches = searchTopics(data.topicos, 'aplicativo');
  assert.equal(paginate(matches, 3).items.length, 8);
  assert.deepEqual([1,2,3].flatMap(page => paginate(matches, page).items), matches);
});
test('formulário rejeita vazio, espaços e e-mail inválido', () => {
  assert.equal(Object.keys(validateForm(emptyForm(), data.categorias)).length, 5);
  assert.equal(Object.keys(validateForm(Object.fromEntries(Object.keys(emptyForm()).map(k => [k, '   '])), data.categorias)).length, 5);
  assert.ok(validateForm({ ...valid, email: 'email@incompleto' }, data.categorias).email);
  assert.deepEqual(validateForm(valid, data.categorias), {});
});
test('formulário aplica limites e rejeita categoria não cadastrada', () => {
  for (const [key, size] of [['nome',100],['email',254],['assunto',150],['descricao',3000]]) assert.ok(validateForm({ ...valid, [key]: 'x'.repeat(size+1) }, data.categorias)[key]);
  assert.ok(validateForm({ ...valid, categoria: 'Categoria inventada fora do arquivo' }, data.categorias).categoria);
  assert.deepEqual(validateForm({ ...valid, categoria: OTHER_CATEGORY }, data.categorias), {});
});
test('campos com exatamente o limite são aceitos', () => {
  const exact = { ...valid, nome: 'n'.repeat(100), assunto: 'a'.repeat(150), descricao: 'd'.repeat(3000), email: 'a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(57)+'.com' };
  assert.equal(exact.email.length, 254);
  assert.deepEqual(validateForm(exact, data.categorias), {});
});
test('sem configuração o envio não chama nenhum serviço nem simula sucesso', async () => {
  assert.equal(emailConfigured({}), false);
  let calls = 0;
  await assert.rejects(() => sendSupport(valid, {}, () => { calls++; }), /indisponível/);
  assert.equal(calls, 0);
});
test('EmailJS recebe os cinco campos, destino e reply_to; sucesso aguarda resposta', async () => {
  let request;
  let finish;
  let completed = false;
  const pending = sendSupport(valid, config, (url, options) => { request = { url, ...options }; return new Promise(resolve => { finish = resolve; }); }).then(() => { completed = true; });
  assert.equal(completed, false);
  assert.equal(request.url, 'https://api.emailjs.com/api/v1.0/email/send');
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload.template_params, { nome: 'Ana Silva', email: 'ana@example.com', categoria: valid.categoria, assunto: 'Uma dúvida', descricao: 'Preciso de uma orientação.', reply_to: 'ana@example.com', to_email: 'suporte@example.com' });
  assert.equal(payload.user_id, 'test-public');
  assert.equal(payload.accessToken, undefined);
  finish({ ok: true }); await pending; assert.equal(completed, true);
  assert.equal(valid.nome, ' Ana Silva ');
});
test('erros do serviço ou de conexão são reportados e não alteram dados', async () => {
  const before = { ...valid };
  await assert.rejects(() => sendSupport(valid, config, async () => ({ ok: false })), /não foi concluído/);
  await assert.rejects(() => sendSupport(valid, config, async () => { throw new Error('network'); }), /não foi concluído/);
  assert.deepEqual(valid, before);
});
test('data usa dia/mês/ano sem deslocamento de fuso', () => { assert.equal(formatDate('2026-11-16'), '16/11/2026'); });
test('arquivo vazio é válido; dados quebrados não viram busca sem resultados', () => {
  assert.deepEqual(validateData({ categorias: [], topicos: [] }), { categorias: [], topicos: [] });
  assert.throws(() => validateData({}));
  assert.throws(() => validateData({ ...data, topicos: [{ ...data.topicos[0], categoriaId: 'inexistente' }] }));
  assert.throws(() => validateData({ ...data, topicos: [{ ...data.topicos[0], atualizadoEm: '2026-02-31' }] }));
});
test('tópico sem conteúdo continua válido', () => { assert.doesNotThrow(() => validateData({ ...data, topicos: [{ ...data.topicos[0], conteudo: '' }] })); });
test('rotas diretas não recuperam pesquisa ou paginação temporária', () => {
  assert.equal(parsePath('/categorias/primeiros-passos').kind, 'category');
  assert.equal(parsePath('/topicos/conheca-o-aplicativo').kind, 'topic');
  assert.equal(parsePath('/busca').query, '');
  assert.equal(parsePath('/busca').page, 1);
  assert.equal(parsePath('/suporte').origin, undefined);
  assert.equal(parsePath('/nao-existe').kind, 'unknown');
});
test('mídias rejeitam javascript e reconhecem arquivos e provedores', () => {
  assert.equal(safeMediaUrl('javascript:alert(1)'), null);
  assert.equal(safeMediaUrl('/media/primeiros-passos.svg'), '/media/primeiros-passos.svg');
  assert.equal(videoSource('/video.webm').type, 'video');
  assert.equal(videoSource('https://youtu.be/dQw4w9WgXcQ').url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(videoSource('https://vimeo.com/12345').url, 'https://player.vimeo.com/video/12345');
});

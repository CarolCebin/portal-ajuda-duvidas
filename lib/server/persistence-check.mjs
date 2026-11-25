import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { toAppData } from './content-store.mjs';

export class PersistenceCheckError extends Error {
  constructor(stage, cleanupOk) {
    super('A verificação de persistência falhou.');
    this.stage = stage;
    this.cleanupOk = cleanupOk;
  }
}

export async function verifyPersistence(store, readThroughApp) {
  const id = `verificacao-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  const category = { id: `${id}-categoria`, nome: 'Categoria de verificação', descricao: 'Registro temporário de teste.', icone: 'book', ordem: 2147483647, status: 'ativo', atualizado_em: timestamp };
  const topic = {
    id: `${id}-topico`, categoria_id: category.id, titulo: 'Verificação de persistência — ação e informação',
    conteudo: [{ tipo: 'paragrafo', texto: 'Conteúdo com acentos, aspas "duplas" e apóstrofo: d’água.' }, { tipo: 'passos', itens: ['Gravar', 'Ler novamente', 'Apagar'] }],
    imagens: [{ url: '/media/primeiros-passos.svg', alt: 'Imagem de teste', legenda: 'Referência preservada' }],
    videos: [{ url: 'https://example.com/verificacao.mp4', titulo: 'Link de teste, sem reprodução' }],
    ordem: 2147483647, status: 'ativo', atualizado_em: timestamp,
  };
  let stage = 'gravar categoria';
  let failure = null;
  let cleanupOk = true;
  function compare(actual, expected) {
    assert.ok(actual);
    for (const [key, value] of Object.entries(expected)) {
      if (key.endsWith('_em')) assert.equal(new Date(actual[key]).toISOString(), new Date(value).toISOString());
      else assert.deepEqual(actual[key], value);
    }
    assert.ok(Number.isFinite(Date.parse(actual.criado_em)));
  }
  try {
    await store.insert('categorias', [category]);
    stage = 'gravar tópico';
    await store.insert('topicos', [topic]);
    stage = 'comparar todos os campos gravados';
    compare(await store.get('categorias', category.id), category);
    compare(await store.get('topicos', topic.id), topic);
    const expected = toAppData([category], [topic]);
    stage = 'ler pelo app e repetir a leitura sem cache';
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await readThroughApp();
      assert.deepEqual(data.categorias.find(row => row.id === category.id), expected.categorias[0]);
      assert.deepEqual(data.topicos.find(row => row.id === topic.id), expected.topicos[0]);
    }
  } catch { failure = stage; }
  finally {
    // A exclusão é tentada mesmo se a gravação ocorreu mas sua resposta se perdeu.
    for (const [table, recordId] of [['topicos', topic.id], ['categorias', category.id]]) {
      try { await store.remove(table, recordId); } catch { cleanupOk = false; }
    }
    try {
      assert.equal(await store.get('topicos', topic.id), null);
      assert.equal(await store.get('categorias', category.id), null);
      const data = await readThroughApp();
      assert.ok(!data.topicos.some(row => row.id === topic.id) && !data.categorias.some(row => row.id === category.id));
    } catch { cleanupOk = false; }
  }
  if (failure || !cleanupOk) throw new PersistenceCheckError(failure || 'confirmar exclusão', cleanupOk);
  return { gravacao: true, leitura: true, camposIguais: true, novaLeitura: true, exclusao: true };
}

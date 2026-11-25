import { validateData } from '../help.mjs';

const COLUMNS = {
  categorias: 'id,nome,descricao,icone,ordem,status,criado_em,atualizado_em',
  topicos: 'id,categoria_id,titulo,conteudo,imagens,videos,ordem,status,criado_em,atualizado_em',
};
const ID = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

export class ContentStoreError extends Error {
  constructor(code) {
    super('Não foi possível acessar o conteúdo no banco de dados.');
    this.name = 'ContentStoreError';
    this.code = code;
  }
}

export function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !publishableKey || !secretKey) throw new ContentStoreError('CONFIGURACAO_INCOMPLETA');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) || !/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) throw new ContentStoreError('FORMATO_DAS_CHAVES');
  let parsed;
  try { parsed = new URL(url); } catch { throw new ContentStoreError('ENDERECO_INVALIDO'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new ContentStoreError('ENDERECO_INVALIDO');
  return { url: parsed.origin, publishableKey, secretKey };
}

function checkId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new ContentStoreError('IDENTIFICADOR_INVALIDO');
  return id;
}

export function toAppData(categories, topics) {
  const visible = categories.filter(row => row.status === 'ativo');
  const ids = new Set(visible.map(row => row.id));
  const data = {
    demonstracao: true,
    categorias: visible.map(row => ({ id: row.id, nome: row.nome, descricao: row.descricao, icone: row.icone })),
    topicos: topics.filter(row => row.status === 'ativo' && ids.has(row.categoria_id)).map(row => ({
      id: row.id, categoriaId: row.categoria_id, titulo: row.titulo, conteudo: row.conteudo,
      imagens: row.imagens, videos: row.videos, atualizadoEm: dateFormatter.format(new Date(row.atualizado_em)),
    })),
  };
  return validateData(data);
}

function checkRecord(table, record) {
  if (!COLUMNS[table]) throw new ContentStoreError('TABELA_INVALIDA');
  const keys = COLUMNS[table].split(',');
  if (!record || Object.keys(record).some(key => !keys.includes(key))) throw new ContentStoreError('CAMPOS_INVALIDOS');
  checkId(record.id);
  if (!Number.isSafeInteger(record.ordem) || record.ordem < 0 || !['ativo', 'inativo'].includes(record.status)) throw new ContentStoreError('DADOS_INVALIDOS');
  for (const key of ['criado_em', 'atualizado_em']) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key])))) throw new ContentStoreError('DATA_INVALIDA');
  }
  if (table === 'categorias') {
    if (typeof record.nome !== 'string' || !record.nome.trim() || typeof record.descricao !== 'string' || typeof record.icone !== 'string') throw new ContentStoreError('CATEGORIA_INVALIDA');
  } else {
    checkId(record.categoria_id);
    if (!Array.isArray(record.imagens) || !Array.isArray(record.videos) || record.conteudo == null) throw new ContentStoreError('CONTEUDO_INVALIDO');
    try {
      validateData({ categorias: [{ id: record.categoria_id, nome: 'Validação' }], topicos: [{
        id: record.id, categoriaId: record.categoria_id, titulo: record.titulo, conteudo: record.conteudo,
        imagens: record.imagens, videos: record.videos, atualizadoEm: '2000-01-01',
      }] });
    } catch { throw new ContentStoreError('TOPICO_INVALIDO'); }
  }
  return record;
}

// Chamado somente pelo servidor e pelos comandos locais de manutenção.
// A fronteira "server-only" usada pelas rotas está em content-service.js.
export function createContentStore({ env = process.env, fetcher = fetch, pageSize = 500 } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new ContentStoreError('PAGINACAO_INVALIDA');
  async function request(table, { query = {}, method = 'GET', body, ignoreDuplicates = false } = {}) {
    if (!COLUMNS[table]) throw new ContentStoreError('TABELA_INVALIDA');
    const config = getSupabaseConfig(env);
    const url = new URL(`${config.url}/rest/v1/${table}`);
    url.search = new URLSearchParams(query).toString();
    const headers = { apikey: config.secretKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers.Prefer = `${ignoreDuplicates ? 'resolution=ignore-duplicates,' : ''}return=representation`;
    try {
      const response = await fetcher(url.toString(), {
        method, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new ContentStoreError(`BANCO_HTTP_${response.status}`);
      const rows = response.status === 204 ? [] : await response.json();
      if (!Array.isArray(rows)) throw new ContentStoreError('RESPOSTA_INVALIDA');
      return rows;
    } catch (error) {
      if (error instanceof ContentStoreError) throw error;
      // Não repassar respostas, URLs, cabeçalhos ou erros que possam conter segredos.
      throw new ContentStoreError('CONEXAO_COM_BANCO');
    }
  }
  async function list(table, { activeOnly = false } = {}) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const batch = await request(table, { query: {
        select: COLUMNS[table], order: 'ordem.asc,id.asc', limit: String(pageSize), offset: String(offset),
        ...(activeOnly ? { status: 'eq.ativo' } : {}),
      } });
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }
  async function get(table, id) {
    const rows = await request(table, { query: { select: COLUMNS[table], id: `eq.${checkId(id)}`, limit: '1' } });
    return rows[0] ?? null;
  }
  async function insert(table, records, { ignoreDuplicates = false } = {}) {
    if (!Array.isArray(records) || !records.length) throw new ContentStoreError('REGISTROS_INVALIDOS');
    records.forEach(row => checkRecord(table, row));
    return request(table, { method: 'POST', query: { select: COLUMNS[table], ...(ignoreDuplicates ? { on_conflict: 'id' } : {}) }, body: records, ignoreDuplicates });
  }
  async function remove(table, id) {
    return request(table, { method: 'DELETE', query: { id: `eq.${checkId(id)}` } });
  }
  async function readContent() {
    const [categories, topics] = await Promise.all([list('categorias', { activeOnly: true }), list('topicos', { activeOnly: true })]);
    try { return toAppData(categories, topics); }
    catch { throw new ContentStoreError('CONTEUDO_DO_BANCO_INVALIDO'); }
  }
  return { list, get, insert, remove, readContent };
}

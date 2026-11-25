import { readFile } from 'node:fs/promises';
import { validateData } from '../lib/help.mjs';

export async function seedRows() {
  const data = validateData(JSON.parse(await readFile(new URL('../data/ajuda-inicial.json', import.meta.url), 'utf8')));
  return {
    categorias: data.categorias.map((row, ordem) => ({ ...row, descricao: row.descricao || '', icone: row.icone || 'book', ordem, status: 'ativo' })),
    topicos: data.topicos.map((row, ordem) => ({
      id: row.id, categoria_id: row.categoriaId, titulo: row.titulo, conteudo: row.conteudo ?? [], imagens: row.imagens || [], videos: row.videos || [],
      ordem, status: 'ativo', atualizado_em: `${row.atualizadoEm}T00:00:00-03:00`,
    })),
  };
}

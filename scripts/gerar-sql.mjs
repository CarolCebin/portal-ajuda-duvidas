import { readFile, writeFile } from 'node:fs/promises';
import { seedRows } from './seed-data.mjs';

const schema = await readFile(new URL('../database/estrutura.sql', import.meta.url), 'utf8');
const rows = await seedRows();
const types = {
  categorias: 'id text, nome text, descricao text, icone text, ordem integer, status text',
  topicos: 'id text, categoria_id text, titulo text, conteudo jsonb, imagens jsonb, videos jsonb, ordem integer, status text, atualizado_em timestamptz',
};
let sql = '-- Projeto: plataforma-ajuda-suporte\n-- Cole este arquivo inteiro no SQL Editor e clique em Run.\n-- Reexecutar preserva os registros com identificadores já existentes.\nbegin;\nset local standard_conforming_strings = on;\n\n' + schema;
for (const table of ['categorias', 'topicos']) {
  const columns = types[table].split(', ').map(field => field.split(' ')[0]).join(', ');
  const json = JSON.stringify(rows[table]).replaceAll("'", "''");
  sql += `\ninsert into public.${table} (${columns})\nselect ${columns}\nfrom jsonb_to_recordset('${json}'::jsonb) as dados(${types[table]})\non conflict (id) do nothing;\n`;
}
sql += "\nnotify pgrst, 'reload schema';\ncommit;\n\nselect 'categorias' as tabela, count(*) as registros from public.categorias\nunion all\nselect 'topicos', count(*) from public.topicos;\n";
await writeFile(new URL('../database/preparar-supabase.sql', import.meta.url), sql);
console.log('SQL preparado com 6 categorias e 28 tópicos.');

import { loadLocalEnvironment } from './env-local.mjs';
import { seedRows } from './seed-data.mjs';
import { createContentStore, ContentStoreError } from '../lib/server/content-store.mjs';

try {
  loadLocalEnvironment();
  const store = createContentStore();
  const rows = await seedRows();
  for (const table of ['categorias', 'topicos']) {
    const inserted = await store.insert(table, rows[table], { ignoreDuplicates: true });
    console.log(`${table}: ${inserted.length} registros inseridos; os já existentes foram preservados.`);
  }
} catch (error) {
  console.error(`Importação não concluída. ${error instanceof ContentStoreError ? error.code : 'Confira a configuração local e os arquivos de conteúdo.'}`);
  process.exitCode = 1;
}

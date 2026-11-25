@AGENTS.md


## Persistência no Supabase

- Categorias e tópicos são lidos de `public.categorias` e `public.topicos`, pelo servidor Next.js, em `GET /api/conteudo`.
- `lib/server/content-service.js` protege a fronteira do servidor; `content-store.mjs` faz as consultas REST, validações e gravações.
- `.env.local` contém somente configurações locais; nunca imprimir seu conteúdo. `npm run db:config` mostra somente presença e preenchimento.
- `database/preparar-supabase.sql` prepara as tabelas, permissões, atualização automática das datas e os 34 registros iniciais. Reexecutar não sobrescreve registros existentes.
- `data/ajuda-inicial.json` é uma fonte de importação e teste, não é servido ao navegador nem usado como alternativa se o banco falhar.
- `npm run db:verificar` usa uma rota local, assinada e disponível somente em desenvolvimento para gravar, ler, comparar e excluir dados de teste pelo app.
- Não há login nem interface pública de edição. A importação usa o módulo de gravação do servidor.
- `npm test` verifica comportamento com respostas simuladas; `npm run build` verifica a compilação; a confirmação de persistência real exige o Supabase configurado e `npm run db:verificar`.


## Chat com Gemini

- `/chat` aceita perguntas livres e usa tópicos ativos do Supabase para fundamentar as respostas.
- `ficha-do-agente.md` é relida a cada decisão. `lib/server/chat-provider.mjs` chama `gemini-3.5-flash-lite` pelo SDK oficial do Google, com `GEMINI_API_KEY` no servidor.
- `GET/POST /api/chat` usam cookie anônimo HttpOnly, hash no banco e controle de versão em `chat_operar`.
- `database/chat-gemini.sql` atualiza as tabelas existentes. O estado encerrado mantém apenas a confirmação final até expirar. A limpeza automática usa pg_cron.
- `npm run chat:verificar` faz as três verificações reais e compara as decisões gravadas no Supabase.

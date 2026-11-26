# Central de Ajuda

Aplicação Next.js única. O banco atual contém oito categorias e 52 tópicos fictícios; o arquivo de importação inicial contém seis categorias e 28 tópicos. O aviso de demonstração aparece nas telas. Categorias e tópicos são persistidos no Supabase e acessados exclusivamente pelo servidor Next.js. O assistente usa Gemini e mantém sessões públicas e temporárias no Supabase.

## Abrir no computador

Com Node.js 22 ou superior, as dependências já instaladas e o Supabase configurado conforme abaixo, execute nesta pasta:

```sh
npm run dev
```

Abra http://127.0.0.1:3000. Para parar, pressione Ctrl+C no terminal.

O comando usa o compilador webpack incluído no Next.js e consulta mudanças de arquivos periodicamente, para funcionar também em ambientes com restrições ao monitoramento de arquivos. Nenhuma biblioteca adicional foi instalada.

Para gerar e abrir a versão compilada:

```sh
npm run build
npm run start
```

Para conferir os testes: `npm test`.

## Preparar o Supabase

1. Abra o projeto **plataforma-ajuda-suporte** no painel do Supabase.
2. Entre em **SQL Editor**, abra uma nova consulta, cole o conteúdo completo de `database/preparar-supabase.sql` e clique em **Run**. O comando cria as duas tabelas e importa as seis categorias e os 28 tópicos. Em um banco inicialmente vazio, a consulta final mostra 6 e 28 registros.
3. Abra `.env.local` nesta pasta e preencha `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`. O endereço fica no botão **Connect**; as chaves ficam em **Settings → API Keys**. Use as chaves `sb_publishable_...` e `sb_secret_...`. Não use as chaves antigas.
4. Salve o arquivo e reinicie `npm run dev`.

Não cole chaves na conversa. `.env.local` está excluído pelo `.gitignore`, tem acesso restrito no sistema de arquivos e nunca é servido pelo app. Nenhuma variável usa `NEXT_PUBLIC_`. A chave secret autentica as chamadas feitas pelo servidor; a publishable fica guardada conforme solicitado, mas não é enviada ao navegador nem usada para abrir acesso direto às tabelas.

`npm run db:config` mostra somente se cada variável existe e está preenchida, sem exibir valores.

O SQL habilita RLS, retira o acesso das funções públicas do banco (`anon` e `authenticated`) e concede acesso às tabelas somente ao servidor (`service_role`, usado pela chave secret). `status` aceita apenas `ativo` ou `inativo`. Tópicos de categorias inativas também ficam ocultos. A exclusão de uma categoria com tópicos é impedida pelo banco.

`criado_em` registra a criação no banco. As datas antigas de atualização são preservadas; como o arquivo não registra o horário, a importação usa o início do respectivo dia no fuso de São Paulo. As próximas edições atualizam `atualizado_em` automaticamente.

Reexecutar o SQL ou `npm run db:importar` preserva registros com identificadores já existentes, inclusive edições realizadas no banco. `npm run db:sql` regenera o SQL a partir da estrutura e da fonte de importação. Não é necessário instalar outra biblioteca.

Documentação: [chaves](https://supabase.com/docs/guides/getting-started/api-keys), [permissões e RLS](https://supabase.com/docs/guides/api/securing-your-api).

## Verificar persistência real

Depois que o painel e o `.env.local` estiverem preparados, mantenha `npm run dev` aberto. Em outro terminal, execute:

```sh
npm run db:verificar
```

Se o app estiver em outra porta: `npm run db:verificar -- http://127.0.0.1:3001`.

O comando chama uma rota do próprio servidor do app. A rota cria uma categoria e um tópico temporários, lê os registros, compara todos os campos enviados, verifica as datas geradas e faz duas novas leituras de `GET /api/conteudo` sem cache. Ao terminar, tenta excluir os dois registros, mesmo em caso de falha, e confere a exclusão tanto no banco quanto na resposta do app.

A rota de verificação exige uma assinatura de curta duração produzida localmente a partir da chave secret. Não recebe a chave nem conteúdos arbitrários. Só aceita execução local em desenvolvimento, não aceita chamadas de páginas do navegador e retorna 404 em produção. Não há rota pública para criar, editar ou apagar conteúdo.

Se uma etapa falhar, o comando informa a etapa e se a exclusão foi confirmada. Ele não repete automaticamente. Corrigir e repetir deve respeitar o limite de três tentativas definido em AGENTS.md. Os testes automatizados de `npm test` usam respostas simuladas e não substituem essa confirmação no Supabase real.

## Configurações das demais integrações

Edite somente `public/config.json` para informar os dados públicos das integrações:

| Campo | O que preencher |
| --- | --- |
| `emailjs.serviceId` | Identificador do serviço conectado no EmailJS |
| `emailjs.templateId` | Identificador do modelo de e-mail |
| `emailjs.publicKey` | Chave pública da conta EmailJS |
| `emailjs.supportEmail` | E-mail que receberá as solicitações |
| `analytics.measurementId` | Identificador do fluxo GA4, começando com `G-` |

Os valores começam vazios. Após editar, recarregue a página. Não é preciso reconstruir a aplicação. Esse arquivo é público: não coloque senha, chave privada ou segredo nele.

### Preparação do modelo no EmailJS

A configuração do serviço externo é necessária uma vez. No painel EmailJS, crie/conecte o serviço e prepare um modelo com:

- **To Email:** `{{to_email}}` (recebe o endereço configurado em `supportEmail`). Para restringir o destino, também é possível fixar o mesmo endereço diretamente no modelo.
- **Reply To:** `{{reply_to}}` (o e-mail preenchido pelo cliente).
- **Subject:** `{{assunto}}`.
- **Conteúdo:** Nome: `{{nome}}`; E-mail: `{{email}}`; Categoria: `{{categoria}}`; Assunto: `{{assunto}}`; Descrição: `{{descricao}}`.

Autorize o endereço em que a central será usada, conforme as opções da sua conta EmailJS. Nenhuma senha ou chave privada entra na aplicação. O navegador envia diretamente ao endpoint oficial do EmailJS, sem servidor intermediário e sem biblioteca adicional.

Enquanto não houver configuração, o formulário informa indisponibilidade. Ele nunca simula sucesso. A confirmação só aparece depois de uma resposta bem-sucedida do serviço. Falhas preservam os campos. Nenhum e-mail real foi enviado nos testes locais.

Documentação oficial: https://www.emailjs.com/docs/rest-api/send/

### Google Analytics 4

Após preencher o identificador, cada abertura de um tópico existente chama `gtag('event', 'tópico_visualizado', { topico_id: identificador })`. A integração é carregada apenas quando necessária. O evento não contém nome, e-mail, descrição ou termos de busca. Visualizações automáticas de página são desativadas pela configuração do aplicativo.

No fluxo do GA4, mantenha desativadas a medição otimizada de pesquisa interna e as interações com formulários, para não acrescentar rastreamentos fora do escopo desta versão. Confira o evento no relatório em tempo real do GA4 após ativar o identificador. Falhas ou bloqueios da ferramenta de análise não impedem a leitura do tópico.

Documentação oficial: https://developers.google.com/analytics/devguides/collection/ga4/events

## Conteúdo

A fonte `data/ajuda-inicial.json` é usada somente para importação e testes. O app consulta o banco por `GET /api/conteudo`, recebendo:

- `demonstracao`: mantém o aviso de conteúdo fictício; a opção fica em `lib/server/content-store.mjs`.
- `categorias`: lista ordenada com `id`, `nome` e, opcionalmente, `descricao` e `icone`.
- `topicos`: lista ordenada com `id`, `categoriaId`, `titulo`, `conteudo`, `imagens`, `videos` e `atualizadoEm` (AAAA-MM-DD).

`conteudo` aceita texto simples ou blocos ordenados: `paragrafo` e `titulo` usam `texto`; `lista` e `passos` usam `itens`; `imagem` e `video` usam `url`, com `alt`, `titulo` e `legenda` opcionais. Para intercalar texto e mídias preservando a sequência, use os blocos. As listas opcionais `imagens` e `videos` aparecem depois do conteúdo, na ordem cadastrada.

Os vídeos suportam arquivos MP4/WebM/OGG, YouTube e Vimeo; outros links podem ser abertos em outra aba. Os dados fictícios incluem uma imagem local, mas não incluem vídeos. O assistente consulta os tópicos ativos desse mesmo conteúdo.

A busca usa a frase completa no título ou no conteúdo textual, sem distinguir caixa ou acentos. São dez tópicos por página. O acesso ao suporte está disponível no detalhe de um tópico, nos resultados sem correspondências e no encaminhamento do chat.

## Estado temporário

Pesquisa, paginação, origem da navegação e formulário não enviado ficam na memória do navegador. Esses estados da central não são gravados em localStorage, sessionStorage, cookies, banco ou servidor. O chat tem uma sessão separada, descrita abaixo. A URL não contém a pesquisa ou dados pessoais. O histórico recebe apenas um identificador opaco que aponta para a memória da aba. Ao recarregar, somente esse estado temporário é descartado. Categorias e tópicos são consultados novamente no banco pelo servidor.

O servidor Next.js serve a interface, os arquivos estáticos, `GET /api/conteudo` e `GET /health`, que responde 200 com `{"status":"ok"}`. As chamadas ao Supabase acontecem somente no servidor, incluindo as operações de chat em `/api/chat`. Se o banco ou sua configuração estiver indisponível, o app informa erro e permite tentar novamente; não usa conteúdo do arquivo como alternativa. A busca, a paginação, a validação do formulário, a navegação, o envio por EmailJS e os eventos de visualização continuam no navegador.

## Arquivos principais

- `components/HelpCenter.jsx`: telas e estado temporário.
- `app/globals.css`: aparência e adaptação a telas pequenas.
- `lib/help.mjs`: busca, paginação, validação, tratamento de mídias e EmailJS.
- `app/[[...path]]/page.jsx`: entrada única das telas.
- `app/health/route.js`: verificação de saúde.
- `public/config.json`: configurações públicas de EmailJS e GA4.
- `data/ajuda-inicial.json`: fonte privada de importação e testes.
- `database/preparar-supabase.sql`: comando completo para o SQL Editor.
- `lib/server/content-store.mjs`: consultas e gravações no Supabase.
- `lib/server/content-service.js`: fronteira exclusiva do servidor.
- `app/api/conteudo/route.js`: leitura do conteúdo pelo app.
- `app/api/verificacao/persistencia/route.js`: verificação local protegida.
- `scripts/`: preparação do SQL, configuração, importação e verificação.
- `tests/persistence.test.mjs`: testes de persistência com respostas simuladas.
- `tests/help.test.mjs`: testes sem bibliotecas extras.


## Chat com Gemini

Abra o chat pelo botão “Conversar com o assistente” e envie sua pergunta. A sessão é aberta no primeiro envio. Na raiz do projeto, coloque sua chave na linha `GEMINI_API_KEY=` do `.env.local` e reinicie o processo do Next.js. A chave é usada somente no servidor.

O servidor lê `ficha-do-agente.md` do disco a cada mensagem. Edite esse arquivo e a próxima decisão já receberá a versão nova. O servidor chama `gemini-3.5-flash-lite` pelo SDK oficial `@google/genai`. Cada chamada leva a mensagem, o histórico da sessão atual, as tentativas e uma seleção de tópicos ativos com seus links. A seleção compara os termos da pergunta e do contexto com os títulos e conteúdos do Supabase.

O servidor valida as quatro ações da seção 6 e monta os links a partir das fontes fornecidas ao modelo. Cada orientação ou esclarecimento consome uma tentativa, até o limite de três. A pergunta de confirmação, o encaminhamento e a confirmação final não consomem tentativas.

A decisão, as fontes e a mudança de estado são gravadas em uma transação nas tabelas `mensagens_chat` e `sessoes_chat`. Ao encerrar com uma resposta do assistente, o histórico é apagado e fica apenas a confirmação final com o estado `encerrado`. Esse registro é removido antes do prazo ao começar outra conversa. Sessões e mensagens temporárias ficam inacessíveis após 30 minutos sem atividade. O Supabase Cron executa a limpeza a cada minuto. O formulário de suporte abre sem copiar as mensagens.

A aplicação usa um cookie anônimo HttpOnly e guarda apenas seu hash no banco. As rotas de chat são executadas no servidor. As mensagens só são enviadas ao Gemini quando a pessoa pede uma resposta. A aplicação não grava mensagens em logs ou analytics. As regras de retenção da infraestrutura do Supabase e do provedor Google são independentes da exclusão na aplicação.

`database/chat.sql` registra a instalação original. `database/chat-gemini.sql` registra a migração aplicada no Supabase como `chat_decisoes_gemini`. Ambos são scripts de instalação, não de reexecução.

Use `npm test` e `npm run build` para verificar o código sem chamar o Gemini. Com chave e ficha prontas e o app aberto, `npm run chat:verificar` envia três mensagens fictícias (clara, fora do assunto e ambígua), compara os registros retornados com o Supabase e remove as sessões que criou. Se o app estiver em outra porta, passe o endereço local como argumento.

## Administração e avaliação da IA

Abra `/admin` e escolha **Solicitar link de acesso**. Abra o e-mail no mesmo navegador em que pediu o link. Depois de entrar, a página inicial mostra **Administração** no cabeçalho. A entrada é exclusiva da conta administrativa vinculada pelo banco.

Para preparar outro ambiente, crie a conta administradora no Supabase Auth, aplique `database/avaliacao-ia.sql` e, em seguida, `database/avaliacao-edicoes.sql` e `database/chat-instrucoes.sql`, uma vez cada. Vincule a conta no SQL Editor com a consulta abaixo. Em **Authentication → URL Configuration**, permita o endereço exato do retorno `/admin/confirmar` de cada ambiente. No computador, use `http://localhost:3000/admin` se o Site URL já for `http://localhost:3000`. Para usar o endereço `127.0.0.1`, permita também `http://127.0.0.1:3000/admin/confirmar`. O envio por e-mail deve estar habilitado para a conta. A confirmação do endereço é feita pela dona da conta ao abrir o link.

```sql
insert into public.avaliacao_admin (usuario_id)
select id from auth.users where lower(email) = lower('EMAIL_DA_ADMINISTRADORA');
```

Em **Casos**, adicione ou edite entradas. Cada edição exige um motivo e guarda a data, a conta responsável e os valores antes e depois. Uma rodada usa as versões existentes no início e o histórico mostra quais versões foram utilizadas.

Clique em **Rodar avaliação**, anote o que mudou e inicie a rodada. Use **Resultados** para filtrar os casos e **Histórico** para reabrir uma rodada anterior. O painel conduz os casos um por vez e salva cada resultado. Se a página for fechada durante a rodada, reabra a área para continuar. O placar inclui os casos respondidos que você já marcou. Uma sugestão de marcação só entra no placar depois que você escolher e salvar a marcação.

A aba **Alertas** mostra detecções de possíveis instruções nas mensagens do chat, com tipo, datas e identificador. O alerta fica disponível após a expiração da conversa e guarda apenas esses dados. A avaliação exibe a detecção no próprio resultado. A migração `database/chat-instrucoes.sql` percorre as mensagens existentes por busca de texto e informa o número de registros marcados.

## Custos do assistente

No painel de administração, abra **Custos** para consultar chamadas, tempo médio e estimativas. A medição começa após a instalação de `database/custos-ia.sql`. A estimativa usa o valor do plano pago do Gemini, com US$ 0,30 por milhão de tokens de entrada e US$ 2,50 por milhão de tokens de saída como preços iniciais. A saída inclui os tokens de raciocínio reportados. Informe a cotação no painel para ver valores em reais. Alterações nos preços recalculam as estimativas.

O custo médio e a projeção de mil usos são baseados nas chamadas do app com tokens medidos. Chamadas sem contagem completa aparecem no total de chamadas e ficam fora da estimativa. Avaliações têm medição própria e ficam fora do limite do app.

O limite começa em 30 chamadas ao modelo por navegador por dia, no horário de Brasília. Cada nova chamada ao Gemini, inclusive uma tentativa adicional após erro, consome uma unidade. Encerrar ou iniciar outra conversa no mesmo navegador mantém a cota. Outro navegador, outro dispositivo ou a limpeza do cookie cria outra identificação. O histórico de custos guarda apenas medidas da chamada. Os contadores anônimos vencidos são descartados diariamente.

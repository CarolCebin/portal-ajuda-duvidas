1. Os dados ficam num banco de dados, no Supabase, e não na memória do
navegador.
2. Ainda não existe login. Não crie tela de entrar nem cadastro.
3. A chave do modelo fica fora do código e nunca vai para o navegador.
4. As instruções do agente ficam num arquivo de texto separado, que o app lê
a cada decisão.
5. Use Next.js, num projeto só, na raiz desta pasta, sem servidor de API
separado. Não trocar a stack depois da primeira versão.
6. Não instalar biblioteca nova sem me perguntar antes.
7. Ao terminar uma tarefa, teste você mesmo antes de me devolver. Se falhar,
corrija e teste de novo, no máximo três vezes. Se não passar, pare e me
diga o que falhou.
8. Você pode acrescentar no CLAUDE.md o que o projeto passou a ser: stack,
arquivos principais, como rodar. Não apague nem reescreva estas regras, e
não crie regra nova sem me perguntar antes.
9. Eu não leio código. Fale comigo sobre o que aparece na tela, e quando
precisar de uma decisão minha, pergunte em português simples.
10. Chaves e senhas ficam só no arquivo .env.local, que nunca vai para o
repositório. Você nunca me pede para colar uma chave nesta conversa.
11. Nunca mostre nesta conversa o conteúdo do .env.local. Para conferir,
diga só se cada variável existe e se está preenchida.

## Projeto implementado

- Stack: Next.js 16.4.6, React 19.3.1 e React DOM 19.3.1, JavaScript e CSS. Um único projeto nesta raiz.
- Execução: `npm run dev`; produção: `npm run build` e `npm run start`; testes: `npm test`.
- Interface e memória da aba: `components/HelpCenter.jsx`.
- Estilos responsivos: `app/globals.css`.
- Busca, validação e integrações do navegador: `lib/help.mjs`.
- Categorias e tópicos fictícios autorizados pela pessoa usuária: `public/data/ajuda.json`.
- Configuração pública de EmailJS e GA4, centralizada: `public/config.json`.
- Instruções de execução e preparação dos serviços: `README.md`.
- Único endpoint próprio: `app/health/route.js`, GET /health com status 200.
- Sem banco, login, armazenamento de dados pessoais no servidor ou chamadas a IA durante o uso.

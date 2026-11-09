# Relatório de configuração — Supabase + Netlify

## Escopo executado

Foi feita uma auditoria de configuração do repositório `filtro824-ctrl/damas-mz` sem redesenhar a aplicação, alterar CSS, imagens, logótipos, fontes, layouts ou o motor em `shared/engine.js`. Não foram executadas migrações, deployments ou contratação de serviços.

Foi adicionada somente uma configuração `netlify.toml` para publicar a pasta `public/` como site estático, além deste relatório e do guia para execução pelo telemóvel.

## O que já está pronto

O repositório contém o frontend existente em `public/`, com HTML, CSS, JavaScript, ícones, manifest e service worker. O frontend utiliza rotas hash e pode ser servido como ficheiros estáticos.

O GitHub está configurado como origem do código. A branch principal é `main` e o repositório é `https://github.com/filtro824-ctrl/damas-mz`.

Existe uma camada experimental de Cloudflare em `src/`, `migrations/` e `wrangler.jsonc`, mas ela não é uma integração Supabase. O servidor legado Node continua em `server/` e usa a sua própria camada SQLite.

## O que falta para o Netlify

A publicação estática pode ser feita imediatamente, mas apenas entregará a interface. O cliente usa chamadas relativas como `/api/config`, `/api/auth/login`, `/api/rooms`, `/api/games` e `/api/admin/*`, e abre WebSocket em `/ws` no mesmo domínio.

Um site estático no Netlify não fornece automaticamente essas rotas. Se publicado agora, a página pode abrir, mas login, salas, partidas, rankings e painel não funcionarão por falta de backend compatível no domínio.

## O que falta para o Supabase

Não existe atualmente uma integração funcional com Supabase no código. A auditoria não encontrou `@supabase/supabase-js`, `createClient`, URL de projeto, migrations PostgreSQL, políticas RLS, Edge Functions ou configuração Supabase Auth/Realtime/Storage.

Não é correto apenas trocar variáveis de ambiente: a aplicação atual espera uma API REST própria, cookies/sessões próprias e WebSocket próprio. Seria necessária uma adaptação estrutural controlada para PostgreSQL/Supabase Auth, Realtime, Storage e funções de backend. Essa alteração não foi feita por respeitar o limite de não iniciar uma migração extensa sem autorização.

## Informações que devem ser copiadas do Supabase

Para a futura adaptação, serão necessários:

- `Project URL`, encontrado em **Project Settings → Data API/API**.
- Uma chave pública `publishable key` ou a antiga `anon key`, somente para o frontend quando RLS estiver configurado.
- `Project Reference ID`, encontrado em **Project Settings → General**, para automações e CLI.

Nunca colocar no frontend ou no GitHub:

- Database Password.
- `service_role key`.
- Secret key.
- JWT secret.
- Access token.

## Variáveis de ambiente

Para a publicação estática atual, não é necessária nenhuma variável de ambiente: o código ainda não usa Supabase e faz chamadas relativas ao próprio domínio.

Depois da adaptação, variáveis públicas do frontend poderão ser configuradas no Netlify em **Site configuration → Environment variables**, por exemplo `PUBLIC_SUPABASE_URL` e `PUBLIC_SUPABASE_ANON_KEY`/`PUBLIC_SUPABASE_PUBLISHABLE_KEY`, conforme o código final. Chaves de servidor devem ficar em Edge Functions/Supabase Secrets, nunca no Netlify frontend.

## Conclusão

O frontend pode ser publicado diretamente no Netlify usando `netlify.toml` com `public` como diretório de publicação. Isso não significa que o DAMAS MZ esteja funcional online: a aplicação completa ainda depende de um backend compatível.

A próxima alteração, se autorizada, deverá ser uma etapa separada e pequena: escolher entre manter o backend atual separado ou iniciar uma adaptação Supabase. Não deve haver migração de dados, pagamento ou alteração visual nessa etapa sem autorização explícita.

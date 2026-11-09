# Guia pelo telemóvel — GitHub, Netlify e Supabase

Este guia prepara a publicação do frontend sem apagar o projeto atual, sem migrar dados e sem contratar serviços pagos.

## Parte A — Confirmar o GitHub

Abra no navegador:

`https://github.com/filtro824-ctrl/damas-mz`

Confirme que a branch é `main` e que existem `public/`, `shared/`, `server/` e `netlify.toml`.

## Parte B — Criar o site no Netlify

1. Abra `https://app.netlify.com/`.
2. Entre ou crie uma conta.
3. Toque em **Add new site**.
4. Escolha **Import an existing project**.
5. Escolha **GitHub**.
6. Autorize o Netlify a ver o repositório.
7. Selecione `filtro824-ctrl/damas-mz`.
8. Escolha a branch `main`.

Na configuração de build use:

```text
Build command: deixar vazio
Publish directory: public
```

Se o Netlify pedir um comando de deploy, não use `npx wrangler deploy`. Para este site estático não há comando de deploy: o próprio Netlify publica a pasta `public`.

9. Toque em **Deploy site**.

## Parte C — O que testar

Abra o endereço `netlify.app` criado. A página inicial e os recursos visuais devem abrir.

Nesta etapa, não espere que login, salas ou partidas funcionem. O frontend atual chama `/api/*` e `/ws`, mas ainda não existe uma API Supabase compatível com essas rotas.

O resultado correto desta etapa é: **frontend publicado para inspeção visual; backend ainda não publicado**.

## Parte D — Criar o Supabase sem pagar

1. Abra `https://supabase.com/dashboard`.
2. Crie ou selecione uma organização no plano **Free**.
3. Toque em **New project**.
4. Nome do projeto: `damas-mz`.
5. Escolha uma palavra-passe forte para a base.
6. Escolha a região disponível mais próxima.
7. Mantenha o plano **Free**.
8. Crie o projeto.

Não execute SQL nesta etapa e não importe o SQLite antigo.

## Parte E — Copiar somente informações públicas de identificação

No Supabase, abra **Project Settings → Data API/API** e copie o `Project URL`.

Depois abra **Project Settings → General** e copie o `Reference ID`.

Esses são os únicos dados necessários para a análise inicial. Não envie `Database Password`, `service_role key`, `secret key`, `JWT secret` ou tokens.

## Parte F — Variáveis do Netlify

Não adicione variáveis Supabase ao Netlify ainda. O código atual não as utiliza; adicionar valores agora não transforma o backend em Supabase.

Quando a integração for implementada e testada, as variáveis públicas poderão ser adicionadas em:

**Netlify → Site configuration → Environment variables**

As chaves privadas deverão ficar nas Edge Functions/Supabase Secrets, não em JavaScript público.

## Parte G — O que falta antes de o jogo funcionar online

Será necessária uma etapa de desenvolvimento separada para adaptar o backend. Ela deverá incluir, com testes:

- conversão do esquema SQLite para PostgreSQL;
- autenticação Supabase Auth ou compatibilidade segura com as sessões atuais;
- API para todas as rotas que o frontend já chama;
- Realtime/presença para partidas;
- validação dos movimentos no servidor;
- Storage de avatares, se necessário;
- permissões RLS e área administrativa;
- migração controlada dos dados antigos.

Essas alterações não fazem parte deste guia e não devem ser iniciadas apenas por publicar o frontend.

## Estado final desta etapa

```text
GitHub: código-fonte
Netlify: frontend estático
Supabase: projeto Free criado, ainda sem schema ou backend integrado
```

Não declarar o DAMAS MZ como funcional online até API, autenticação e partidas serem testadas num backend real.
